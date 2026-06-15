import fs from "node:fs";
import path from "node:path";

const skillDir = path.join(process.cwd(), "lib", "skill");

export const SKILL_MD = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
export const BOARD_TEMPLATE_MD = fs.readFileSync(
  path.join(skillDir, "board_template.md"),
  "utf8",
);
