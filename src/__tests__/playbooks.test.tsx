import { describe, expect, it } from "vitest";
import { AGENT_PLAYBOOKS, MAX_PLAYBOOKS, coreSystemPrompt, pickPlaybooks, playbookPrompt, wantsResearch } from "@/lib/playbooks";
import { SYSTEM_PROMPT } from "@/lib/ai";
import { BLOCKS_PROMPT } from "@/lib/blocks";

const ids = (m: string) => pickPlaybooks(m).map((p) => p.id);

describe("agent playbooks: catalogue", () => {
  it("has the seven playbooks, each with an id, title, triggers and concise guidance", () => {
    expect(AGENT_PLAYBOOKS.map((p) => p.id).sort()).toEqual(["browsing", "drafting", "forms", "lookup", "research", "scheduling", "signin"]);
    for (const p of AGENT_PLAYBOOKS) {
      expect(p.title.length).toBeGreaterThan(3);
      expect(p.triggers.length).toBeGreaterThan(0);
      const lines = p.guidance.split("\n").length;
      expect(lines).toBeGreaterThanOrEqual(4);
      expect(lines).toBeLessThanOrEqual(15);
      expect(p.guidance.length).toBeLessThan(1400);
    }
  });
});

describe("pickPlaybooks", () => {
  it.each([
    ["kal 3 baje meeting set karo", "scheduling"],
    ["kal 4 baje dentist reminder lagao", "scheduling"],
    ["Schedule a call with the team next Monday at 5 pm", "scheduling"],
    ["ye form bhar do", "forms"],
    ["Please fill the registration form for the hackathon", "forms"],
    ["research best laptops under 50k", "research"],
    ["Next.js 16 me kya naya hai? sources ke saath", "research"],
    ["draft an email to my manager asking for leave on Friday", "drafting"],
    ["Mere landlord ko rent late hone ka email draft karo", "drafting"],
    ["boss ko ek message likh do ki main late aaunga", "drafting"],
    ["irctc website pe jaake PNR status check karo", "browsing"],
    ["meri unread emails dikhao", "lookup"],
    ["aaj ki meetings batao calendar se", "lookup"],
  ])("%s -> %s first", (msg, id) => {
    expect(ids(msg)[0]).toBe(id);
  });

  it.each(["hi", "hello bhai", "thanks!", "", "   ", "2+2 kitna hota hai"])("%j -> none", (msg) => {
    expect(pickPlaybooks(msg)).toEqual([]);
  });

  it("never returns more than two", () => {
    const busy = "research best options, draft an email, fill the form on the website portal, schedule a meeting kal 3 baje and show my unread emails";
    const got = pickPlaybooks(busy);
    expect(got.length).toBe(MAX_PLAYBOOKS);
    expect(new Set(got.map((p) => p.id)).size).toBe(got.length);
  });

  it("research asks fetch live web results; drafting and small talk don't", () => {
    expect(wantsResearch("Next.js 16 me kya naya hai? sources ke saath")).toBe(true);
    expect(wantsResearch("research best laptops under 50k")).toBe(true);
    expect(wantsResearch("Mere landlord ko rent late hone ka email draft karo")).toBe(false);
    expect(wantsResearch("hi")).toBe(false);
  });

  it("can combine two related playbooks", () => {
    expect(ids("Open the college portal website and fill the admission form")).toEqual(expect.arrayContaining(["forms", "browsing"]));
  });
});

describe("system prompt injection", () => {
  it("adds only the chosen playbook's guidance", () => {
    const p = playbookPrompt("kal 3 baje meeting set karo");
    const sched = AGENT_PLAYBOOKS.find((x) => x.id === "scheduling")!;
    expect(p).toContain(sched.guidance);
    for (const other of AGENT_PLAYBOOKS.filter((x) => x.id !== "scheduling")) expect(p).not.toContain(other.guidance);
  });

  it("adds nothing for small talk", () => {
    expect(playbookPrompt("hi")).toBe("");
    expect(coreSystemPrompt("hi")).not.toContain("HOW TO WORK THROUGH THIS REQUEST");
  });

  it("the full system prompt carries the chosen guidance alongside the base rules and cards", () => {
    const sys = coreSystemPrompt("Mere landlord ko rent late hone ka email draft karo");
    const draft = AGENT_PLAYBOOKS.find((x) => x.id === "drafting")!;
    expect(sys.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(sys).toContain(draft.guidance);
    expect(sys).toContain(BLOCKS_PROMPT);
    expect(sys).toMatch(/Never send on your own/);
    const research = coreSystemPrompt("research best laptops under 50k");
    expect(research).toContain(AGENT_PLAYBOOKS.find((x) => x.id === "research")!.guidance);
    expect(research).not.toContain(draft.guidance);
  });

  it("keeps prompt growth small (two playbooks at most ~2.5k chars)", () => {
    const base = coreSystemPrompt("hi").length;
    const grown = coreSystemPrompt("research best options and draft an email to my landlord").length;
    expect(grown - base).toBeLessThan(2600);
  });
});
