import { ACTIVE_EDITION_SLUG } from "@/lib/config";
import { PreregExperience } from "@/components/prereg-experience";

export default function Home() {
  return <PreregExperience editionSlug={ACTIVE_EDITION_SLUG} />;
}
