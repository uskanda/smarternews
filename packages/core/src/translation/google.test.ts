import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { fakeFetch } from "../testing/http.ts";
import { GOOGLE_TRANSLATE_URL, GoogleTranslator, googleChars } from "./google.ts";

const KEY = "test-key-0123456789abcdef";

interface Sent {
  q: string[];
  target: string;
  format: string;
}

/** The API as recorded: every string comes back wrapped, with the tags it was sent with. */
function setup(answer?: (sent: Sent) => Response) {
  const recorded = (sent: Sent) =>
    Response.json({ data: { translations: sent.q.map((html) => ({ translatedText: html.replace(/>([^<]+)</g, ">訳:$1<"), detectedSourceLanguage: "en" })) } });
  const fake = fakeFetch({ [GOOGLE_TRANSLATE_URL]: (request) => (answer ?? recorded)(JSON.parse(request.body!) as Sent) });
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: fake.fetchImpl, sleep: async () => {} });
  const sent = () => fake.requests.map((request) => JSON.parse(request.body!) as Sent);
  return { translator: new GoogleTranslator({ fetcher, apiKey: KEY }), requests: fake.requests, sent };
}

describe("GoogleTranslator", () => {
  it("sends each segment as HTML and gives the translations back as Markdown", async () => {
    const s = setup();
    const output = await s.translator.translate(
      [{ text: "## A heading" }, { text: "Read **this** and [the notes](https://example.org/notes?a=1&b=2)." }, { text: "- An item" }],
      "ja",
    );

    expect(s.sent()).toEqual([
      {
        q: ["<h2>A heading</h2>", '<p>Read <strong>this</strong> and <a href="https://example.org/notes?a=1&amp;b=2" rel="noopener noreferrer">the notes</a>.</p>', "<ul>\n<li>An item</li>\n</ul>"],
        target: "ja",
        format: "html",
      },
    ]);
    expect(output).toEqual({
      texts: ["## 訳:A heading", "訳:Read **訳:this**訳: and [訳:the notes](https://example.org/notes?a=1&b=2)訳:.", "- 訳:An item"],
      sourceLanguage: "en",
    });
  });

  it("sends a title as text, and reads the answer as text", async () => {
    const s = setup((sent) => Response.json({ data: { translations: sent.q.map(() => ({ translatedText: "A &amp; B の &lt;b&gt; と *星*" })) } }));
    const output = await s.translator.translate([{ text: "A & B <b> and *stars*", plain: true }], "ja");
    expect(s.sent()[0]!.q).toEqual(["A &amp; B &lt;b&gt; and *stars*"]);
    expect(output).toEqual({ texts: ["A & B の <b> と *星*"], sourceLanguage: null });
  });

  it("drops a tag the answer slipped in that the conversion does not allow", async () => {
    const s = setup(() => Response.json({ data: { translations: [{ translatedText: "<p>訳<script>alert(1)</script><iframe src='https://example.org/'></iframe></p>" }] } }));
    expect((await s.translator.translate([{ text: "Text" }], "ja")).texts).toEqual(["訳"]);
  });

  it("splits what it sends into requests of 128 segments and 5,000 characters", async () => {
    const many = setup();
    await many.translator.translate(Array.from({ length: 300 }, (_unused, index) => ({ text: `T${index}`, plain: true })), "ja");
    expect(many.sent().map((sent) => sent.q.length)).toEqual([128, 128, 44]);

    const long = setup();
    const output = await long.translator.translate(Array.from({ length: 4 }, () => ({ text: "x".repeat(1990) })), "ja");
    expect(long.sent().map((sent) => sent.q.length)).toEqual([2, 2]);
    expect(output.texts).toHaveLength(4);
  });

  it("counts the characters of the HTML it would send", () => {
    expect(googleChars([{ text: "Hello", plain: true }, { text: "**Hi**" }])).toBe("Hello".length + "<p><strong>Hi</strong></p>".length);
  });

  it("sends the key in a header, and keeps it out of the address and out of what a failure says", async () => {
    const s = setup(() => Response.json({ error: { code: 403, message: `API key not valid: ${KEY}` } }, { status: 403 }));
    const failure = await s.translator.translate([{ text: "Text" }], "ja").catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/403/);
    expect((failure as Error).message).not.toContain(KEY);
    expect(s.requests[0]!.url).toBe(GOOGLE_TRANSLATE_URL);
    expect(s.requests[0]!.headers["x-goog-api-key"]).toBe(KEY);
    expect(s.requests[0]!.body).not.toContain(KEY);
  });

  it("fails when the answer holds another number of translations", async () => {
    const s = setup(() => Response.json({ data: { translations: [{ translatedText: "one" }] } }));
    await expect(s.translator.translate([{ text: "a" }, { text: "b" }], "ja")).rejects.toThrow(/2/);
  });
});
