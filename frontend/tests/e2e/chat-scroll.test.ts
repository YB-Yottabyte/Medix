import { expect, test } from "@playwright/test";

const CHAT_URL = "/chat/00000000-0000-4000-8000-000000000001";

test("keeps the user's upward scroll position while response content grows", async ({
  page,
}) => {
  await page.goto(CHAT_URL);

  const container = page.getByTestId("messages-container");
  await expect(container).toBeVisible();

  await container.evaluate((element) => {
    const streamedResponse = document.createElement("div");
    streamedResponse.style.height = "4000px";
    streamedResponse.style.flex = "0 0 4000px";
    element.firstElementChild?.appendChild(streamedResponse);
  });

  await expect
    .poll(() =>
      container.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop
      )
    )
    .toBeLessThan(25);

  const bounds = await container.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) {
    return;
  }

  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await page.mouse.wheel(0, -900);

  const userScrollTop = await container.evaluate(
    (element) => element.scrollTop
  );

  await container.evaluate((element) => {
    const moreContent = document.createElement("div");
    moreContent.style.height = "600px";
    moreContent.style.flex = "0 0 600px";
    element.firstElementChild?.appendChild(moreContent);
  });

  await page.waitForTimeout(300);

  const position = await container.evaluate((element) => ({
    maximum: element.scrollHeight - element.clientHeight,
    scrollTop: element.scrollTop,
  }));

  expect(position.scrollTop).toBeLessThan(position.maximum - 100);
  expect(position.scrollTop).toBeLessThanOrEqual(userScrollTop + 5);
});
