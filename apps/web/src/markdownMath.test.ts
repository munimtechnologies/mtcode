import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";

import { createIncrementalMarkdownPlugin } from "./markdown-incremental";

function parser() {
  return unified().use(remarkParse).use(remarkMath, { singleDollarTextMath: true }).use(remarkGfm);
}

function parse(source: string) {
  const processor = parser();
  return processor.runSync(processor.parse(source), source);
}

describe("streamed chat math", () => {
  it("can parse every streamed prefix and matches a fresh parse after cached code", () => {
    const incremental = createIncrementalMarkdownPlugin();
    const source =
      "```ts\nconst x = 1;\n```\n\n" +
      String.raw`Inline $\frac{x}{2}$ and $y$.` +
      "\n\n$$\n\\begin{aligned}a &= b \\\\\nc &= d\\end{aligned}\n$$";
    for (let end = 0; end <= source.length; end++) {
      const prefix = source.slice(0, end);
      const processor = parser().use(incremental);
      expect(processor.runSync(processor.parse(prefix), prefix), `prefix ${end}`).toEqual(
        parse(prefix),
      );
    }
  });
});
