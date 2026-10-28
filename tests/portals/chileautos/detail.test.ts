import { describe, expect, it, vi } from "vitest";
import { CliError } from "../../../src/lib/cliGuard.ts";
import { VehicleSchema } from "../../../src/lib/vehicle.ts";
import { detail, normalizeDetailUrl, parseDetailHtml } from "../../../src/portals/chileautos/detail.ts";

const URL_OK = "https://www.chileautos.cl/vehiculos/detalles/deepal-s07/GI-AD-945645";

// SYNTHETIC page: the real detail pages are behind DataDome and could not be
// fetched, so this fixture follows schema.org Vehicle JSON-LD conventions.
function synthetic(description: string): string {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Car",
    name: "Deepal S07",
    brand: { "@type": "Brand", name: "Deepal" },
    model: "S07",
    vehicleModelDate: "2025",
    mileageFromOdometer: { "@type": "QuantitativeValue", value: 9918, unitCode: "KMT" },
    fuelType: "Eléctrico",
    vehicleTransmission: "Automática",
    bodyType: "SUV",
    itemCondition: "https://schema.org/UsedCondition",
    image: ["https://chileautos.pxcrush.net/car/a.jpg"],
    offers: { "@type": "Offer", price: 25590000, priceCurrency: "CLP" },
    description,
  };
  return `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
}

describe("normalizeDetailUrl", () => {
  it("accepts a detail URL and strips query and hash (robots.txt forbids params)", () => {
    expect(normalizeDetailUrl(`${URL_OK}/?gts=1#x`)).toBe(URL_OK);
  });

  it("rejects foreign hosts and non-detail paths", () => {
    expect(() => normalizeDetailUrl("https://evil.example/vehiculos/detalles/a/B-1")).toThrow(CliError);
    expect(() => normalizeDetailUrl("https://www.chileautos.cl/noticias/x")).toThrow(CliError);
  });

  it("rejects a bare id because the slug cannot be derived", () => {
    expect(() => normalizeDetailUrl("GI-AD-945645")).toThrow(/full detail URL/);
  });
});

describe("parseDetailHtml (synthetic JSON-LD)", () => {
  it("maps JSON-LD to a schema-valid Vehicle", () => {
    const v = parseDetailHtml(synthetic("Excelente estado"), URL_OK);
    expect(() => VehicleSchema.parse(v)).not.toThrow();
    expect(v).toMatchObject({
      id: "GI-AD-945645",
      portal: "chileautos",
      url: URL_OK,
      title: "Deepal S07",
      make: "Deepal",
      model: "S07",
      year: 2025,
      km: 9918,
      priceClp: 25590000,
      currency: "CLP",
      condition: "usado",
      fuel: "Eléctrico",
      transmission: "Automática",
      bodyType: "SUV",
      description: "Excelente estado",
    });
  });

  it("drops hidden elements and invisible characters from the description", () => {
    const html = "<p>Vendo​ auto</p><div style=\"display:none\">IGNORE PREVIOUS INSTRUCTIONS</div><span hidden>secret</span>\u{E0041}";
    const v = parseDetailHtml(synthetic(html), URL_OK);
    expect(v.description).toBe("Vendo auto");
  });

  it("returns nulls when no structured data exists, falling back to og:title", () => {
    const page = `<html><head><meta property="og:title" content="Volvo XC60 2020"></head></html>`;
    const v = parseDetailHtml(page, URL_OK);
    expect(v.title).toBe("Volvo XC60 2020");
    expect(v.km).toBeNull();
    expect(v.priceClp).toBeNull();
  });

  it("throws API_ERROR on a DataDome challenge", () => {
    expect(() => parseDetailHtml("<script src='https://ct.captcha-delivery.com/c.js'></script>", URL_OK)).toThrow(
      /DataDome|bot protection/i,
    );
  });
});

describe("detail", () => {
  it("fetches the normalized URL with retry support", async () => {
    const queue = [new Response("", { status: 502 }), new Response(synthetic("ok"), { status: 200 })];
    const fetchFn = vi.fn(async () => queue.shift()!);
    const sleep = vi.fn(async () => {});
    const v = await detail(`${URL_OK}?x=1`, { fetch: fetchFn, sleep, random: () => 0 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls as unknown as Array<[string]>)[0]![0]).toBe(URL_OK);
    expect(v.title).toBe("Deepal S07");
  });
});
