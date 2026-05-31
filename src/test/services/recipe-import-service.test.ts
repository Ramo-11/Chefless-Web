import { describe, it, expect, vi, afterEach } from "vitest";
import {
  detectSource,
  extractCaption,
  extractFromUrl,
} from "../../services/recipe-import-service";

function mockFetchHtml(html: string, finalUrl: string): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    url: finalUrl,
    text: async () => html,
  } as Response);
}

describe("recipe-import-service", () => {
  describe("detectSource", () => {
    it("maps Instagram hosts", () => {
      expect(detectSource("https://www.instagram.com/reel/abc123/")).toEqual({
        type: "instagram",
        url: "https://www.instagram.com/reel/abc123/",
        siteName: "Instagram",
      });
    });

    it("maps TikTok hosts", () => {
      expect(detectSource("https://www.tiktok.com/@chef/video/9").type).toBe(
        "tiktok"
      );
    });

    it("maps both YouTube hosts", () => {
      expect(detectSource("https://youtube.com/watch?v=x").type).toBe("youtube");
      expect(detectSource("https://youtu.be/x").type).toBe("youtube");
    });

    it("maps Pinterest hosts including country TLDs", () => {
      expect(detectSource("https://pinterest.com/pin/1").type).toBe("pinterest");
      expect(detectSource("https://pinterest.co.uk/pin/1").type).toBe(
        "pinterest"
      );
    });

    it("maps Facebook hosts", () => {
      expect(detectSource("https://www.facebook.com/watch/?v=1").type).toBe(
        "facebook"
      );
      expect(detectSource("https://fb.watch/abc/").type).toBe("facebook");
    });

    it("falls back to website with the hostname as siteName", () => {
      expect(detectSource("https://www.allrecipes.com/recipe/123")).toEqual({
        type: "website",
        url: "https://www.allrecipes.com/recipe/123",
        siteName: "allrecipes.com",
      });
    });

    it("returns other for an unparseable URL", () => {
      expect(detectSource("not a url").type).toBe("other");
    });
  });

  describe("extractCaption", () => {
    const igSource = {
      type: "instagram" as const,
      url: "https://www.instagram.com/reel/abc/",
      siteName: "Instagram",
    };

    it("unwraps an Instagram og:description and captures the handle", () => {
      const html = `<html><head>
        <meta property="og:title" content="chef.jane on Instagram">
        <meta property="og:description" content="1,234 likes, 56 comments - chef.jane on May 1, 2026: &quot;One-pan lemon garlic pasta. Boil 200g spaghetti, toss with garlic, lemon, and parmesan. So good!&quot;">
      </head></html>`;

      const result = extractCaption(html, igSource);
      expect(result).not.toBeNull();
      expect(result?.text.startsWith("One-pan lemon garlic pasta")).toBe(true);
      expect(result?.text.includes('"')).toBe(false);
      expect(result?.author).toBe("@chef.jane");
    });

    it("reads a generic page og:description", () => {
      const html = `<html><head>
        <meta property="og:description" content="A cozy weeknight stew with beef, carrots, and potatoes simmered slowly.">
      </head></html>`;

      const result = extractCaption(html, {
        type: "website",
        url: "https://example.com/post",
        siteName: "example.com",
      });
      expect(result?.text).toContain("cozy weeknight stew");
      expect(result?.author).toBeUndefined();
    });

    it("falls back to twitter:description then meta name=description", () => {
      const twitterHtml = `<meta name="twitter:description" content="Smoky chipotle black bean tacos with lime crema on top.">`;
      expect(
        extractCaption(twitterHtml, {
          type: "website",
          url: "https://x.test/a",
        })?.text
      ).toContain("chipotle black bean tacos");

      const descHtml = `<meta name="description" content="Crispy roasted brussels sprouts tossed in balsamic glaze.">`;
      expect(
        extractCaption(descHtml, { type: "website", url: "https://x.test/b" })
          ?.text
      ).toContain("brussels sprouts");
    });

    it("returns null when there is no usable caption", () => {
      expect(
        extractCaption("<html><head></head></html>", {
          type: "website",
          url: "https://x.test/c",
        })
      ).toBeNull();
    });

    it("returns null for a caption shorter than the minimum", () => {
      const html = `<meta property="og:description" content="Yum!">`;
      expect(extractCaption(html, igSource)).toBeNull();
    });
  });

  describe("extractFromUrl", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns INVALID_URL for an SSRF-blocked host", async () => {
      const result = await extractFromUrl("http://127.0.0.1/admin");
      expect(result).toEqual({ kind: "error", code: "INVALID_URL" });
    });

    it("returns INVALID_URL for a malformed URL", async () => {
      const result = await extractFromUrl("ftp://example.com/file");
      expect(result).toEqual({ kind: "error", code: "INVALID_URL" });
    });

    it("returns a structured result from JSON-LD Recipe markup", async () => {
      const html = `<html><head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Recipe",
          "name": "Garlic Butter Shrimp",
          "recipeIngredient": ["2 tbsp butter", "1 lb shrimp"],
          "recipeInstructions": [
            { "@type": "HowToStep", "text": "Melt butter." },
            { "@type": "HowToStep", "text": "Add shrimp and cook." }
          ]
        }
        </script>
      </head></html>`;
      const url = "https://www.seriouseats.com/garlic-butter-shrimp";
      mockFetchHtml(html, url);

      const result = await extractFromUrl(url);
      expect(result.kind).toBe("structured");
      if (result.kind === "structured") {
        expect(result.recipe.title).toBe("Garlic Butter Shrimp");
        expect(result.recipe.ingredients).toHaveLength(2);
        expect(result.recipe.steps).toHaveLength(2);
        expect(result.source.type).toBe("website");
      }
    });

    it("returns a caption result when no JSON-LD but a caption exists", async () => {
      const html = `<html><head>
        <meta property="og:title" content="chef.jane on Instagram">
        <meta property="og:description" content="200 likes, 10 comments - chef.jane on May 2, 2026: &quot;Quick weeknight stir fry with broccoli, soy sauce, and ginger over rice.&quot;">
      </head></html>`;
      const url = "https://www.instagram.com/reel/abc123/";
      mockFetchHtml(html, url);

      const result = await extractFromUrl(url);
      expect(result.kind).toBe("caption");
      if (result.kind === "caption") {
        expect(result.text).toContain("stir fry");
        expect(result.source.type).toBe("instagram");
        expect(result.source.author).toBe("@chef.jane");
      }
    });

    it("returns NO_CAPTION when the page has no recipe and no caption", async () => {
      const url = "https://example.com/empty";
      mockFetchHtml("<html><head></head><body></body></html>", url);

      const result = await extractFromUrl(url);
      expect(result).toEqual({ kind: "error", code: "NO_CAPTION" });
    });
  });
});
