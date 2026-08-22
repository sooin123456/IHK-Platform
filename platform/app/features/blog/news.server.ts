import evidenceBasedTakeoff from "./docs/evidence-based-takeoff.mdx?raw";
import fieldFileValidation from "./docs/field-file-validation.mdx?raw";
import revit2025FieldBeta from "./docs/revit-2025-field-beta.mdx?raw";

export interface NewsFrontmatter {
  title: string;
  description: string;
  date: string;
  category: string;
  author: string;
  slug: string;
  image: string;
}

const newsSources = {
  "evidence-based-takeoff": evidenceBasedTakeoff,
  "field-file-validation": fieldFileValidation,
  "revit-2025-field-beta": revit2025FieldBeta,
} as const;
const requiredFields: Array<keyof NewsFrontmatter> = [
  "title",
  "description",
  "date",
  "category",
  "author",
  "slug",
  "image",
];

function parseFrontmatter(value: unknown, filename: string): NewsFrontmatter {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid company news frontmatter: ${filename}`);
  }
  const record = value as Record<string, unknown>;
  if (
    !requiredFields.every(
      (key) => typeof record[key] === "string" && record[key].trim().length > 0,
    )
  ) {
    throw new Error(`Invalid company news frontmatter: ${filename}`);
  }
  const frontmatter = record as unknown as NewsFrontmatter;
  if (!/^[a-z0-9-]+$/.test(frontmatter.slug)) {
    throw new Error(`Invalid company news slug: ${filename}`);
  }
  if (Number.isNaN(Date.parse(frontmatter.date))) {
    throw new Error(`Invalid company news date: ${filename}`);
  }
  return frontmatter;
}

function parseNewsSource(source: string, filename: string) {
  const normalized = source.replaceAll("\r\n", "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`Invalid company news document: ${filename}`);

  const frontmatter = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const separator = line.indexOf(":");
      if (separator < 1)
        throw new Error(`Invalid company news frontmatter: ${filename}`);
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      ];
    }),
  );

  return {
    frontmatter: parseFrontmatter(frontmatter, filename),
    body: match[2].trim(),
  };
}

const newsDocuments = Object.entries(newsSources).map(([slug, source]) => {
  const filename = `${slug}.mdx`;
  const document = parseNewsSource(source, filename);
  if (`${document.frontmatter.slug}.mdx` !== filename) {
    throw new Error(`Company news slug must match filename: ${filename}`);
  }
  return document;
});

export async function getNewsPosts(): Promise<NewsFrontmatter[]> {
  return newsDocuments
    .map(({ frontmatter }) => frontmatter)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export async function getNewsPost(slug: string) {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    const error = new Error("Invalid company news slug");
    Object.assign(error, { code: "ENOENT" });
    throw error;
  }
  const document = newsDocuments.find(
    ({ frontmatter }) => frontmatter.slug === slug,
  );
  if (!document) {
    const error = new Error("Company news post not found");
    Object.assign(error, { code: "ENOENT" });
    throw error;
  }
  return document;
}
