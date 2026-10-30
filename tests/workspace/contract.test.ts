import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

/** Parse the YAML-ish frontmatter block into a key -> raw value map. */
function frontmatter(md: string): Record<string, string> | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Concrete repo paths (no placeholders or globs) mentioned after `tsx`. */
function referencedScripts(md: string): string[] {
  const found = new Set<string>();
  for (const m of md.matchAll(/tsx\s+(src\/[A-Za-z0-9_./*<>-]+\.ts)/g)) found.add(m[1]!);
  return [...found];
}

const COMMANDS = ["car-setup", "car-scrape", "car-rank", "car-export", "car-buscar"];
const AGENTS = ["vehicle-fetcher", "vehicle-scorer"];

describe("commands", () => {
  it("ships every expected command", () => {
    expect(readdirSync(join(ROOT, ".claude/commands")).sort()).toEqual(COMMANDS.map((c) => `${c}.md`).sort());
  });

  it.each(COMMANDS)("%s has frontmatter with a description", (name) => {
    const fm = frontmatter(read(`.claude/commands/${name}.md`));
    expect(fm).not.toBeNull();
    expect(fm!.description?.length).toBeGreaterThan(10);
  });

  it.each(COMMANDS)("%s only references CLIs that exist", (name) => {
    for (const script of referencedScripts(read(`.claude/commands/${name}.md`))) {
      if (/[*<>]/.test(script)) continue;
      expect(existsSync(join(ROOT, script)), script).toBe(true);
    }
  });

  it("every portal CLI the commands can discover exists for each SKILL.md", () => {
    for (const portal of readdirSync(join(ROOT, "src/portals"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      expect(existsSync(join(ROOT, `src/portals/${portal}/SKILL.md`)), portal).toBe(true);
      expect(existsSync(join(ROOT, `src/portals/${portal}/cli.ts`)), portal).toBe(true);
      expect(frontmatter(read(`src/portals/${portal}/SKILL.md`))?.enabled, portal).toMatch(/^(true|false)$/);
    }
  });

  it("car-scrape documents --portals handling and the portal discovery source", () => {
    const md = read(".claude/commands/car-scrape.md");
    expect(md).toContain("--portals");
    expect(md).toContain("src/portals/*/SKILL.md");
    expect(md).toContain("vehicle-fetcher");
    expect(md).toContain("store/cli.ts ingest");
  });

  it("car-rank dispatches scorers and stores results with set-ai", () => {
    const md = read(".claude/commands/car-rank.md");
    expect(md).toContain("vehicle-scorer");
    expect(md).toContain("set-ai");
    expect(md).toContain("store/cli.ts rank");
  });

  it("car-buscar chains setup, scrape, rank and export", () => {
    const md = read(".claude/commands/car-buscar.md");
    for (const step of ["/car-setup", "/car-scrape", "/car-rank", "/car-export"]) expect(md).toContain(step);
  });

  it("car-setup validates the profile with the validator script", () => {
    expect(read(".claude/commands/car-setup.md")).toContain("src/matching/validate-profile.ts");
  });

  it("car-setup asks whether the body type is a hard requirement and saves bodyTypeStrict", () => {
    const md = read(".claude/commands/car-setup.md");
    expect(md).toContain("bodyTypeStrict");
    expect(md).toContain("filtro duro");
    expect(md).toContain("filtro blando");
  });
});

describe("agents", () => {
  it.each(AGENTS)("%s has frontmatter, restricted tools and the untrusted-input rule", (name) => {
    const md = read(`.claude/agents/${name}.md`);
    const fm = frontmatter(md);
    expect(fm).not.toBeNull();
    expect(fm!.name).toBe(name);
    expect(fm!.description?.length).toBeGreaterThan(10);
    const tools = fm!.tools ?? "";
    expect(tools).toMatch(/Bash\(npx tsx src\/(portals|store)\//);
    expect(tools).not.toMatch(/\b(Edit|Write|NotebookEdit)\b/);
    expect(tools).not.toMatch(/Bash(?!\()/); // never bare, unrestricted Bash
    expect(md).toMatch(/untrusted/i);
    expect(md).toMatch(/never instructions/i);
  });

  it("vehicle-scorer documents the strict JSON result contract", () => {
    const md = read(".claude/agents/vehicle-scorer.md");
    for (const token of ["key", "ai", "score", "strengths", "gaps", "redFlags", "status", "scored", "gone", "unreachable"]) {
      expect(md).toContain(token);
    }
  });

  it.each(AGENTS)("%s only references CLIs that exist", (name) => {
    for (const script of referencedScripts(read(`.claude/agents/${name}.md`))) {
      if (/[*<>]/.test(script)) continue;
      expect(existsSync(join(ROOT, script)), script).toBe(true);
    }
  });
});

describe("skill and docs", () => {
  it("vehicle-matching skill and rubric exist with frontmatter", () => {
    const fm = frontmatter(read(".claude/skills/vehicle-matching/SKILL.md"));
    expect(fm?.name).toBe("vehicle-matching");
    expect(fm?.description?.length).toBeGreaterThan(10);
    const rubric = read(".claude/skills/vehicle-matching/rubric.md");
    for (const term of ["UF", "IVA", "financ", "permiso de circulación", "revisión técnica", "SOAP", "patente", "Strong", "Poor"]) {
      expect(rubric.toLowerCase(), term).toContain(term.toLowerCase());
    }
  });

  it("settings allow-list points at scripts that exist and keeps edits behind ask", () => {
    const settings = JSON.parse(read(".claude/settings.json")) as { permissions: { allow: string[]; ask?: string[] } };
    const allow = settings.permissions.allow;
    for (const required of ["src/export/cli.ts", "src/store/cli.ts", "src/matching/validate-profile.ts"]) {
      expect(allow.some((a) => a.includes(required)), required).toBe(true);
    }
    for (const rule of allow) {
      const m = /tsx (src\/[^\s*:)]+\.ts)/.exec(rule);
      if (m) expect(existsSync(join(ROOT, m[1]!)), rule).toBe(true);
    }
    const ask = settings.permissions.ask ?? [];
    expect(ask.some((a) => a.startsWith("Edit(.claude/commands"))).toBe(true);
    expect(ask.some((a) => a.startsWith("Edit(.claude/agents"))).toBe(true);
  });

  it("README documents the flow and honest limitations", () => {
    const md = read("README.md");
    expect(md).toMatch(/## Limitaciones/);
    for (const term of ["Chileautos", "DataDome", "Mercado Libre", "ClaudeBot", "/car-buscar"]) expect(md, term).toContain(term);
  });
});
