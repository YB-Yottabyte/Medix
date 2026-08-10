"""Parameter-controlled logistic, MLP, and spline-KAN confidence models."""

from __future__ import annotations

import math

import torch
from torch import nn


class LogisticCalibrator(nn.Module):
    """Linear log-odds baseline."""

    def __init__(self, input_size: int):
        super().__init__()
        self.output = nn.Linear(input_size, 1)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.output(inputs).squeeze(-1)


class MLPCalibrator(nn.Module):
    """One-hidden-layer MLP baseline."""

    def __init__(self, input_size: int, hidden_size: int):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_size, hidden_size),
            nn.SiLU(),
            nn.Linear(hidden_size, 1),
        )

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.network(inputs).squeeze(-1)


class BSplineKANLayer(nn.Module):
    """KAN layer with a learnable cubic B-spline on every directed edge."""

    def __init__(
        self,
        input_size: int,
        output_size: int,
        *,
        grid_size: int = 5,
        spline_order: int = 3,
        grid_range: tuple[float, float] = (-3.0, 3.0),
    ):
        super().__init__()
        if input_size < 1 or output_size < 1:
            raise ValueError("KAN layer dimensions must be positive")
        if grid_size < 2 or spline_order < 1:
            raise ValueError("KAN grid_size must be >= 2 and spline_order must be positive")

        self.input_size = input_size
        self.output_size = output_size
        self.grid_size = grid_size
        self.spline_order = spline_order
        self.grid_range = grid_range
        basis_count = grid_size + spline_order

        step = (grid_range[1] - grid_range[0]) / grid_size
        knots = (
            torch.arange(-spline_order, grid_size + spline_order + 1, dtype=torch.float32) * step
            + grid_range[0]
        )
        self.register_buffer("knots", knots)
        self.base_weight = nn.Parameter(torch.empty(output_size, input_size))
        self.spline_weight = nn.Parameter(torch.empty(output_size, input_size, basis_count))
        self.bias = nn.Parameter(torch.zeros(output_size))
        self.reset_parameters()

    def reset_parameters(self) -> None:
        nn.init.kaiming_uniform_(self.base_weight, a=math.sqrt(5))
        nn.init.normal_(self.spline_weight, mean=0.0, std=0.02)
        bound = 1 / math.sqrt(self.input_size)
        nn.init.uniform_(self.bias, -bound, bound)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        if inputs.ndim != 2 or inputs.shape[1] != self.input_size:
            raise ValueError(f"Expected [batch, {self.input_size}] KAN input")
        base_output = torch.nn.functional.silu(inputs) @ self.base_weight.T
        spline_output = torch.einsum(
            "bin,oin->bo", self._b_spline_basis(inputs), self.spline_weight
        )
        return base_output + spline_output + self.bias

    def _b_spline_basis(self, inputs: torch.Tensor) -> torch.Tensor:
        expanded = inputs.unsqueeze(-1)
        knots = self.knots.to(dtype=inputs.dtype, device=inputs.device)
        basis = ((expanded >= knots[:-1]) & (expanded < knots[1:])).to(inputs.dtype)

        for degree in range(1, self.spline_order + 1):
            remaining = basis.shape[-1] - 1
            left_denominator = knots[degree : degree + remaining] - knots[:remaining]
            right_denominator = (
                knots[degree + 1 : degree + remaining + 1] - knots[1 : remaining + 1]
            )
            left = (expanded - knots[:remaining]) / left_denominator
            right = (knots[degree + 1 : degree + remaining + 1] - expanded) / right_denominator
            basis = left * basis[..., :remaining] + right * basis[..., 1 : remaining + 1]
        return basis


class KANCalibrator(nn.Module):
    """Two-layer KAN used as the nonlinear experimental condition."""

    def __init__(
        self,
        input_size: int,
        hidden_size: int = 4,
        *,
        grid_size: int = 5,
        spline_order: int = 3,
    ):
        super().__init__()
        self.hidden = BSplineKANLayer(
            input_size,
            hidden_size,
            grid_size=grid_size,
            spline_order=spline_order,
        )
        self.output = BSplineKANLayer(
            hidden_size,
            1,
            grid_size=grid_size,
            spline_order=spline_order,
        )

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.output(self.hidden(inputs)).squeeze(-1)


def trainable_parameters(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad)


def make_models(input_size: int) -> dict[str, nn.Module]:
    """Construct baselines with an approximately parameter-matched MLP and KAN."""

    kan = KANCalibrator(input_size=input_size)
    kan_parameters = trainable_parameters(kan)
    mlp_hidden = max(1, round((kan_parameters - 1) / (input_size + 2)))
    return {
        "logistic": LogisticCalibrator(input_size),
        "mlp": MLPCalibrator(input_size, mlp_hidden),
        "kan": kan,
    }
