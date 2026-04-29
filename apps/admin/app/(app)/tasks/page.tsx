import { getActiveBrand } from '@/lib/active-brand';
import { loadTaskCounts, loadTasks, type TaskFilter } from '@/lib/tasks';
import { loadTeam } from '@/lib/team';
import { PageHeader } from '@/components/page-header';
import { TasksView } from '@/components/tasks/tasks-view';

const VALID_TABS: TaskFilter[] = ['today', 'overdue', 'upcoming', 'done'];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const active = await getActiveBrand();
  if (!active) return null;
  const sp = await searchParams;
  const tab: TaskFilter = (VALID_TABS as string[]).includes(sp.tab ?? '')
    ? (sp.tab as TaskFilter)
    : 'today';

  const [tasks, counts, team] = await Promise.all([
    loadTasks(active.id, tab),
    loadTaskCounts(active.id),
    loadTeam(active.id),
  ]);

  const subtitle =
    counts.overdue > 0
      ? `${counts.overdue} overdue · ${counts.today} today`
      : `${counts.today} due today · ${counts.upcoming} upcoming`;

  return (
    <>
      <PageHeader title="Tasks" subtitle={subtitle} />
      <TasksView
        activeTab={tab}
        counts={counts}
        tasks={tasks}
        team={team.map((t) => ({
          id: t.memberId,
          name: t.fullName ?? t.email,
        }))}
      />
    </>
  );
}
