import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loading, PageHeader } from "@/components/common";
import { api } from "@/api/client";
import type { Experience, ExperienceInput } from "@/api/apply";
import { errorText } from "@/lib/errors";
import { useAsync } from "@/lib/useAsync";
import { ExperienceCard } from "./ExperienceCard";
import { ExperienceForm } from "./ExperienceForm";
import { EMPTY_EXPERIENCE } from "./experienceFields";

export default function ApplyExperiencePage() {
  const { data, error, loading, setData } = useAsync(api.experiences);

  async function attempt(fn: () => Promise<void>) {
    try {
      await fn();
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    }
  }
  const replace = (x: Experience) => setData((d) => d && d.map((y) => (y.id === x.id ? x : y)));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Experience"
        description="Everything you've built, one project or role each, in enough detail to answer any question from it and to reread before an interview."
      />
      <Loading error={error} loading={loading && !data} />
      {data && (
        <div className="grid gap-4">
          {data.map((e) => (
            <ExperienceCard
              key={e.id}
              experience={e}
              onSave={(form) => attempt(async () => replace(await api.patchExperience(e.id, form)))}
              onDelete={() => void attempt(async () => {
                await api.deleteExperience(e.id);
                setData((d) => d && d.filter((y) => y.id !== e.id));
              })}
            />
          ))}
          <Card>
            <CardHeader>
              <CardTitle>{data.length ? "Add another" : "Add your first project or role"}</CardTitle>
              <CardDescription>Write it rough and long: answers are cut down from here, not padded up.</CardDescription>
            </CardHeader>
            <CardContent>
              <ExperienceForm
                initial={EMPTY_EXPERIENCE}
                idPrefix="exp-new"
                submitLabel="Add"
                onSave={(form: ExperienceInput) => attempt(async () => {
                  const created = await api.addExperience(form);
                  setData((d) => (d ? [...d, created] : [created]));
                })}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
