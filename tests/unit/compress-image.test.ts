import { describe, expect, it } from "vitest";
import { CLIENT_IMAGE_MAX_SIDE, compressImageForUpload, fitWithin } from "@/lib/compress-image";

describe("Redução da foto da nota antes do envio", () => {
  it("limita o maior lado mantendo a proporção", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: CLIENT_IMAGE_MAX_SIDE, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: CLIENT_IMAGE_MAX_SIDE });
  });

  it("não amplia imagens pequenas nem aceita dimensões inválidas", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 600)).toEqual({ width: 0, height: 0 });
  });

  it("devolve o arquivo original fora do navegador ou quando já é pequeno", async () => {
    const small = new File([new Uint8Array(10)], "nota.jpg", { type: "image/jpeg" });
    expect(await compressImageForUpload(small)).toBe(small);
  });
});
