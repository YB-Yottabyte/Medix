import { expect, test } from "@playwright/test";
import { QWEN_CHAT_MODEL } from "@/lib/ai/models";

const MODEL_BUTTON_REGEX = /GPT-OSS|Qwen/i;
const CHAT_URL = "/chat/00000000-0000-4000-8000-000000000001";

test.describe("Model Selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CHAT_URL);
  });

  test("displays a model button", async ({ page }) => {
    const modelButton = page
      .locator("button")
      .filter({ hasText: MODEL_BUTTON_REGEX })
      .first();
    await expect(modelButton).toBeVisible();
  });

  test("opens model selector popover on click", async ({ page }) => {
    const modelButton = page
      .locator("button")
      .filter({ hasText: MODEL_BUTTON_REGEX })
      .first();
    await expect(modelButton).toHaveAttribute("type", "button");
    await modelButton.click();

    await expect(page.getByPlaceholder("Search models...")).toBeVisible();
  });

  test("can search for models", async ({ page }) => {
    const modelButton = page
      .locator("button")
      .filter({ hasText: MODEL_BUTTON_REGEX })
      .first();
    await modelButton.click();

    const searchInput = page.getByPlaceholder("Search models...");
    await searchInput.fill("Qwen");

    await expect(page.getByText("Qwen 3.5 9B").first()).toBeVisible();
  });

  test("can close model selector by clicking outside", async ({ page }) => {
    const modelButton = page
      .locator("button")
      .filter({ hasText: MODEL_BUTTON_REGEX })
      .first();
    await modelButton.click();

    await expect(page.getByPlaceholder("Search models...")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByPlaceholder("Search models...")).not.toBeVisible();
  });

  test("shows available models and their providers", async ({ page }) => {
    const modelButton = page
      .locator("button")
      .filter({ hasText: MODEL_BUTTON_REGEX })
      .first();
    await modelButton.click();

    await expect(page.getByText("Available")).toBeVisible();
    await expect(page.getByText("Provider: Groq")).toBeVisible();
    await expect(page.getByText(/Provider: Ollama/)).toBeVisible();
  });

  test("can select a different model", async ({ page }) => {
    const modelButton = page
      .locator("button")
      .filter({ hasText: MODEL_BUTTON_REGEX })
      .first();
    await modelButton.click();

    await page.getByText("Qwen 3.5 9B").first().click();

    await expect(page.getByPlaceholder("Search models...")).not.toBeVisible();

    await expect(
      page.locator("button").filter({ hasText: "Qwen 3.5 9B" }).first()
    ).toBeVisible();

    await page.getByTestId("model-selector").filter({ visible: true }).click();
    await expect(
      page.getByRole("option", {
        name: "Use Qwen 3.5 9B, currently selected",
      })
    ).toHaveAttribute("data-active-model", "true");

    const modelCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === "chat-model"
    );
    expect(decodeURIComponent(modelCookie?.value ?? "")).toBe(QWEN_CHAT_MODEL);
  });
});
