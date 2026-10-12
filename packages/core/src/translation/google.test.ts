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

/** The API as recorded: every string comes back with the tags it was sent with, each piece of text marked. */
function setup(answer?: (sent: Sent) => Response) {
  const recorded = (sent: Sent) =>
    Response.json({ data: { translations: sent.q.map((html) => ({ translatedText: html.replace(/(^|>)([^<]+)/g, "$1訳:$2"), detectedSourceLanguage: "en" })) } });
  const fake = fakeFetch({ [GOOGLE_TRANSLATE_URL]: (request) => (answer ?? recorded)(JSON.parse(request.body!) as Sent) });
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: fake.fetchImpl, sleep: async () => {} });
  const sent = () => fake.requests.map((request) => JSON.parse(request.body!) as Sent);
  return { translator: new GoogleTranslator({ fetcher, apiKey: KEY }), requests: fake.requests, sent };
}

describe("GoogleTranslator", () => {
  it("sends only what is to be translated: no wrapper of the block, and a number in place of every address", async () => {
    const s = setup();
    const output = await s.translator.translate(
      [{ text: "## A heading" }, { text: "Read **this** and [the notes](https://example.org/notes?a=1&b=2)." }, { text: "- An item" }, { text: "> Said *once*" }],
      "ja",
    );

    expect(s.sent()).toEqual([
      {
        q: ["A heading", 'Read <strong>this</strong> and <a href="0">the notes</a>.', "An item", "Said <em>once</em>"],
        target: "ja",
        format: "html",
      },
    ]);
    expect(output).toEqual({
      texts: ["## 訳:A heading", "訳:Read **訳:this**訳: and [訳:the notes](https://example.org/notes?a=1&b=2)訳:.", "- 訳:An item", "> 訳:Said *訳:once*"],
      sourceLanguage: "en",
    });
  });

  it("keeps the number of an item of a numbered list", async () => {
    const s = setup();
    const output = await s.translator.translate([{ text: "1. one" }, { text: "2. two" }, { text: "10. ten" }], "ja");
    expect(s.sent()[0]!.q).toEqual(["one", "two", "ten"]);
    expect(output.texts).toEqual(["1. 訳:one", "2. 訳:two", "10. 訳:ten"]);
  });

  it("puts every address back where its number comes back, also when the order changed", async () => {
    const text = "See [one](https://a.example.org/1) and [two](https://b.example.org/2) ![pic](https://img.example.org/p.png)";
    const s = setup((sent) =>
      Response.json({ data: { translations: sent.q.map(() => ({ translatedText: '<a href="1">二</a>と<a href="0">一</a> <img src="2" alt="図">' })) } }),
    );
    const output = await s.translator.translate([{ text }], "ja");
    expect(s.sent()[0]!.q[0]).toBe('See <a href="0">one</a> and <a href="1">two</a> <img src="2" alt="pic">');
    expect(output.texts).toEqual(["[二](https://b.example.org/2)と[一](https://a.example.org/1) ![図](https://img.example.org/p.png)"]);
  });

  it("keeps the words of a link whose number does not come back as one it sent", async () => {
    const s = setup(() => Response.json({ data: { translations: [{ translatedText: '<a href="7">七</a>と<a href="https://evil.example.org/">外</a>と<a href="0">一</a>' }] } }));
    const output = await s.translator.translate([{ text: "[one](https://a.example.org/1)" }], "ja");
    expect(output.texts).toEqual(["七と外と[一](https://a.example.org/1)"]);
  });

  it("sends a block whole when it holds blocks of its own, with numbers for its addresses all the same", async () => {
    const s = setup();
    const text = "- Outer [link](https://example.org/x)\n  - Inner";
    const output = await s.translator.translate([{ text }, { text: "3. three\n\n   second paragraph" }], "ja");
    expect(s.sent()[0]!.q[0]).toContain('<a href="0">link</a>');
    expect(s.sent()[0]!.q[0]).toMatch(/^<ul>/);
    expect(output.texts[0]).toContain("[訳:link](https://example.org/x)");
    expect(output.texts[0]).toMatch(/^- /);
    expect(output.texts[1]).toMatch(/^3\. /);
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

  it("counts the characters it would send, which are those of the text and of the tags inside it", () => {
    expect(googleChars([{ text: "Hello", plain: true }, { text: "**Hi**" }])).toBe("Hello".length + "<strong>Hi</strong>".length);
    expect(googleChars([{ text: "[a](https://example.org/a/very/long/address?with=parameters)" }])).toBe('<a href="0">a</a>'.length);
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
