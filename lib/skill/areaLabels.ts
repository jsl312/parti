import { Language, ResearchArea } from "@/lib/types/project";

const KO: Record<ResearchArea, string> = {
  site_context: "① 사이트 맥락",
  users_community: "② 사용자 · 커뮤니티",
  precedent_studies: "③ 선례 분석",
  socio_cultural: "④ 사회·문화적 이슈",
  typology_limits: "⑤ 유형의 한계",
};

const EN: Record<ResearchArea, string> = {
  site_context: "① Site Context",
  users_community: "② Users & Community",
  precedent_studies: "③ Precedent Studies",
  socio_cultural: "④ Socio-Cultural Issues",
  typology_limits: "⑤ Typology Limitations",
};

export function areaLabel(area: ResearchArea, language: Language): string {
  return language === "ko" ? KO[area] : EN[area];
}

export function areaOrGeneralLabel(
  area: ResearchArea | "general",
  language: Language,
): string {
  if (area === "general") return language === "ko" ? "전체" : "General";
  return areaLabel(area, language);
}
