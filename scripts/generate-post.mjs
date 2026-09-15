// scripts/generate-post.mjs
//
// Picks an unused topic from scripts/topics.json, asks Gemini to draft a
// full personal-finance blog post, and writes it into
// src/content/blog/<slug>.md matching the Astro content-collection schema
// (title, description, pubDate, updatedDate?, heroImage?).
//
// Requires: GEMINI_API_KEY env var. Uses Node's built-in fetch (Node 18+),
// no extra npm dependencies.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TOPICS_PATH = path.join(ROOT, "scripts", "topics.json");
const USED_PATH = path.join(ROOT, "scripts", "topics-used.json");
const BLOG_DIR = path.join(ROOT, "src", "content", "blog");

const GEMINI_MODEL = "gemini-flash-latest"; // Google's auto-updated "current" Flash alias
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function pickTopic() {
  const topics = await readJson(TOPICS_PATH, []);
  let used = await readJson(USED_PATH, []);

  if (topics.length === 0) {
    throw new Error("scripts/topics.json is empty — add some topics first.");
  }

  let available = topics.filter((t) => !used.includes(t.topic));

  // Rotation exhausted: start a fresh cycle instead of stalling forever.
  if (available.length === 0) {
    used = [];
    available = topics;
  }

  const chosen = available[Math.floor(Math.random() * available.length)];
  used.push(chosen.topic);
  await fs.writeFile(USED_PATH, JSON.stringify(used, null, 2) + "\n");
  return chosen;
}

async function draftPost(topic) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");

  const prompt = `You are writing an original article for "Wealth Notes", a personal finance blog focused on budgeting, saving, investing, and building wealth with practical, actionable advice — no hype, no guaranteed-return claims, no specific stock/fund picks.

Topic: "${topic.topic}" (category: ${topic.category})

Write a complete, original blog post of roughly 900-1300 words. Use clear H2/H3 markdown subheadings, short paragraphs, and at least one bullet or numbered list. Tone: warm, practical, encouraging — like a knowledgeable friend, not a lecture. Avoid clichés like "In today's world" or "In conclusion". Do not give specific investment recommendations or promise returns; keep advice general and educational.

Respond with ONLY a single valid JSON object (no markdown code fences, no extra text) with exactly these keys:
{
  "title": "string, under 70 characters, no quotes inside",
  "description": "string, 1-2 sentences, under 160 characters, for SEO meta description",
  "body": "string, the full post body in markdown, starting directly with content (no H1 title line, since the title is rendered separately)"
}`;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 4096 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";

  const cleaned = text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse Gemini response as JSON:\n${text}`);
  }

  if (!parsed.title || !parsed.description || !parsed.body) {
    throw new Error(`Gemini response missing required fields:\n${JSON.stringify(parsed, null, 2)}`);
  }

  return parsed;
}

function toFrontmatter(post) {
  const pubDate = new Date().toISOString().slice(0, 10);
  const escapedTitle = post.title.replace(/"/g, '\\"');
  const escapedDesc = post.description.replace(/"/g, '\\"');
  return `---
title: "${escapedTitle}"
description: "${escapedDesc}"
pubDate: "${pubDate}"
---

${post.body.trim()}
`;
}

async function main() {
  await fs.mkdir(BLOG_DIR, { recursive: true });

  const topic = await pickTopic();
  console.log(`Selected topic: [${topic.category}] ${topic.topic}`);

  const post = await draftPost(topic);
  const slug = slugify(post.title);
  const filePath = path.join(BLOG_DIR, `${slug}.md`);

  // Avoid clobbering an existing file with the same slug.
  let finalPath = filePath;
  let n = 2;
  while (
    await fs
      .access(finalPath)
      .then(() => true)
      .catch(() => false)
  ) {
    finalPath = path.join(BLOG_DIR, `${slug}-${n}.md`);
    n += 1;
  }

  await fs.writeFile(finalPath, toFrontmatter(post));
  console.log(`Wrote ${path.relative(ROOT, finalPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
