import { redirect } from "next/navigation";

// Memory management now lives in Settings → Privacy & memory.
export default function MemoryPage() {
  redirect("/app/settings/privacy");
}
