import { compile, type FormatCallback } from "html-to-text";

// Headings become "## Title" lines so the chunker can find section boundaries and
// keep heading metadata. Link targets and images are dropped: they add noise to
// retrieval text, and citations use the section's GOV.UK deep link instead.
const markedHeading: FormatCallback = (elem, walk, builder, formatOptions) => {
  const marker = typeof formatOptions["marker"] === "string" ? formatOptions["marker"] : "##";
  builder.openBlock({ leadingLineBreaks: 2 });
  builder.addLiteral(`${marker} `);
  walk(elem.children ?? [], builder);
  builder.closeBlock({ trailingLineBreaks: 2 });
};

const toText = compile({
  wordwrap: false,
  formatters: { markedHeading },
  selectors: [
    { selector: "a", options: { ignoreHref: true } },
    { selector: "img", format: "skip" },
    { selector: "h1", format: "markedHeading", options: { marker: "##" } },
    { selector: "h2", format: "markedHeading", options: { marker: "##" } },
    { selector: "h3", format: "markedHeading", options: { marker: "###" } },
    { selector: "h4", format: "markedHeading", options: { marker: "####" } },
    { selector: "h5", format: "markedHeading", options: { marker: "####" } },
    { selector: "h6", format: "markedHeading", options: { marker: "####" } },
    { selector: "table", format: "dataTable", options: { uppercaseHeaderCells: false, maxColumnWidth: 80 } },
    { selector: "ul", options: { itemPrefix: " - " } }
  ]
});

/**
 * Converts GOV.UK body HTML to stable plain text. The same HTML always produces the same
 * text, so content hashes only change when the wording or structure changes.
 */
export function normaliseHtml(html: string): string {
  return toText(html)
    .normalize("NFC")
    .replaceAll(" ", " ")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
