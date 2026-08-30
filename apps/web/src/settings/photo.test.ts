// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { squarePhotoDataUrl } from "./photo";

describe("squarePhotoDataUrl", () => {
  let closeSpy: ReturnType<typeof vi.fn>;
  let drawImageSpy: ReturnType<typeof vi.fn>;
  let originalCreateImageBitmap: typeof globalThis.createImageBitmap;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalToDataURL: typeof HTMLCanvasElement.prototype.toDataURL;

  beforeEach(() => {
    closeSpy = vi.fn();
    drawImageSpy = vi.fn();
    originalCreateImageBitmap = globalThis.createImageBitmap;
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  });

  afterEach(() => {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
  });

  function stubBitmap(width: number, height: number) {
    globalThis.createImageBitmap = vi.fn(async () => ({ width, height, close: closeSpy })) as never;
  }

  function stubCanvas(hasContext = true) {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => (hasContext ? ({ drawImage: drawImageSpy } as never) : null)) as never;
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/jpeg;base64,FAKE") as never;
  }

  it("centre-crops a wider-than-tall image to a square before drawing", async () => {
    stubBitmap(400, 200);
    stubCanvas();
    const file = new File([""], "photo.jpg", { type: "image/jpeg" });
    const result = await squarePhotoDataUrl(file, 128);
    // side = min(400,200) = 200; sx = (400-200)/2 = 100; sy = (200-200)/2 = 0
    expect(drawImageSpy).toHaveBeenCalledWith(expect.anything(), 100, 0, 200, 200, 0, 0, 128, 128);
    expect(result).toBe("data:image/jpeg;base64,FAKE");
  });

  it("centre-crops a taller-than-wide image the other way", async () => {
    stubBitmap(200, 500);
    stubCanvas();
    const file = new File([""], "photo.jpg", { type: "image/jpeg" });
    await squarePhotoDataUrl(file, 64);
    // side = 200; sx = 0; sy = (500-200)/2 = 150
    expect(drawImageSpy).toHaveBeenCalledWith(expect.anything(), 0, 150, 200, 200, 0, 0, 64, 64);
  });

  it("sets the canvas to the requested output size and encodes as jpeg at quality 0.85", async () => {
    stubBitmap(300, 300);
    stubCanvas();
    const toDataURLSpy = HTMLCanvasElement.prototype.toDataURL as unknown as ReturnType<typeof vi.fn>;
    await squarePhotoDataUrl(new File([""], "p.jpg"), 96);
    expect(toDataURLSpy).toHaveBeenCalledWith("image/jpeg", 0.85);
  });

  it("closes the bitmap even when drawing succeeds (the finally block)", async () => {
    stubBitmap(100, 100);
    stubCanvas();
    await squarePhotoDataUrl(new File([""], "p.jpg"), 32);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when the canvas has no 2d context, but still closes the bitmap (finally runs on the error path too)", async () => {
    stubBitmap(100, 100);
    stubCanvas(false);
    await expect(squarePhotoDataUrl(new File([""], "p.jpg"), 32)).rejects.toThrow("canvas 2d context unavailable");
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
