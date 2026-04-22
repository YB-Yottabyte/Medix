const FLASK_BACKEND_URL =
  process.env.FLASK_API_URL ??
  process.env.MEDVIDQA_BACKEND_URL ??
  "http://localhost:8080";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const image = formData.get("image");

    if (!(image instanceof File) || image.size === 0) {
      return Response.json(
        { error: "Multimodal analysis requires an image file." },
        { status: 400 }
      );
    }

    const backendForm = new FormData();
    backendForm.append("image", image, image.name || "chat-image.png");

    const query = formData.get("query");
    const x = formData.get("x");
    const y = formData.get("y");

    if (typeof query === "string" && query.trim()) {
      backendForm.append("query", query.trim());
    }
    if (typeof x === "string" && x.trim()) {
      backendForm.append("x", x.trim());
    }
    if (typeof y === "string" && y.trim()) {
      backendForm.append("y", y.trim());
    }

    const response = await fetch(`${FLASK_BACKEND_URL}/api/multimodal_query`, {
      method: "POST",
      body: backendForm,
    });

    const text = await response.text();

    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: `Could not reach the multimodal backend at ${FLASK_BACKEND_URL}. ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
      { status: 502 }
    );
  }
}
