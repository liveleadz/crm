'use client';

// Per-automation editor with a Standard ↔ Visual toggle. Standard renders
// the existing list-style form for simple linear rules. Visual mounts the
// React Flow canvas. Switching to Visual on a simple rule materializes a
// linear graph from the actions[]; saving the canvas flips mode='graph'.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveAutomationGraph,
  setAutomationEnabled,
  setAutomationMode,
  renameAutomation,
  updateAutomation,
} from '@/app/actions/automations';
import { graphFromSimple, type Automation, type WorkflowGraph } from '@/lib/automation-types';
import type { WorkflowRunRow } from '@/lib/workflow-runs';
import { AutomationForm } from './automation-form';
import type { StageRef, TagRef, DispositionRef } from './automations-manager';
import { WorkflowCanvas } from './canvas/workflow-canvas';
import { HeaderBar, type EditorView, type SaveState } from './canvas/header-bar';
import { RunsView } from './runs-view';

type Props = {
  initial: Automation;
  stages: StageRef[];
  tags: TagRef[];
  dispositions: DispositionRef[];
  members?: { id: string; full_name: string | null; email: string }[];
  runs?: WorkflowRunRow[];
};

export function AutomationEditor({ initial, stages, tags, dispositions, members, runs }: Props) {
  const router = useRouter();
  const [view, setView] = useState<EditorView>(initial.mode === 'graph' ? 'visual' : 'standard');
  const [name, setName] = useState(initial.name);
  const [enabled, setEnabled] = useState(initial.isEnabled);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [, startTransition] = useTransition();

  // The graph is the source of truth in visual mode. Initialize from either
  // the persisted graph or a synthesized linearization of the simple rule
  // so users always see a meaningful canvas on first open.
  const initialGraph = useMemo<WorkflowGraph>(
    () =>
      initial.graph ??
      graphFromSimple({
        triggerType: initial.triggerType,
        triggerConfig: initial.triggerConfig,
        actions: initial.actions,
      }),
    [initial],
  );
  const [graph, setGraph] = useState<WorkflowGraph>(initialGraph);
  const dirtyGraph = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced auto-save for graph changes. Fires 700ms after the last edit.
  useEffect(() => {
    if (!dirtyGraph.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(async () => {
      const res = await saveAutomationGraph({ id: initial.id, graph });
      if (res.ok) {
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1500);
      } else {
        setSaveState('error');
      }
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [graph, initial.id]);

  // Memoized so its identity is stable across renders. The canvas wires this
  // into a useEffect; an unstable reference would re-fire that effect every
  // render and create an infinite loop with the parent's setGraph.
  const onCanvasChange = useCallback((next: WorkflowGraph) => {
    dirtyGraph.current = true;
    setGraph(next);
  }, []);

  async function changeView(next: EditorView) {
    if (next === view) return;
    if (next === 'runs') {
      setView('runs');
      // Refresh from the server so the runs list reflects what's happened
      // since the page was first loaded.
      router.refresh();
      return;
    }
    setView(next);
    if (next === 'visual' && initial.mode !== 'graph') {
      // First switch into Visual on a simple rule — promote to graph mode
      // and persist the synthesized graph immediately so the canvas owns
      // the source of truth from now on.
      setSaveState('saving');
      const res = await saveAutomationGraph({ id: initial.id, graph: initialGraph });
      if (res.ok) {
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1500);
      } else {
        setSaveState('error');
      }
    }
    if (next === 'standard' && initial.mode === 'graph') {
      // Going back to Standard with a non-linear graph isn't safe — warn but
      // allow. The simple form will see the linearized actions[] and lose
      // any branches/waits. Users opt in explicitly via the toggle.
      const ok = window.confirm(
        'Switching to Standard view drops branches and waits. Continue?',
      );
      if (!ok) {
        setView('visual');
        return;
      }
      const res = await setAutomationMode({ id: initial.id, mode: 'simple' });
      if (!res.ok) setSaveState('error');
    }
  }

  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      await setAutomationEnabled({ id: initial.id, enabled: next });
      router.refresh();
    });
  }

  function rename(newName: string) {
    setName(newName);
    startTransition(async () => {
      await renameAutomation({ id: initial.id, name: newName });
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col">
      <HeaderBar
        initialName={name}
        view={view}
        onViewChange={changeView}
        saveState={saveState}
        enabled={enabled}
        onToggleEnabled={toggleEnabled}
        onRename={rename}
      />

      <div className="relative flex-1 overflow-hidden">
        {view === 'runs' ? (
          <RunsView runs={runs ?? []} />
        ) : view === 'visual' ? (
          <WorkflowCanvas
            initial={initialGraph}
            ctx={{
              stages,
              tags,
              dispositions,
              members,
              automation: { id: initial.id, webhookToken: initial.webhookToken },
            }}
            onChange={onCanvasChange}
          />
        ) : (
          <div className="flex-1 overflow-auto p-6">
            {initial.mode === 'graph' ? (
              <div className="mx-auto max-w-2xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-[12.5px] text-amber-700 dark:text-amber-400">
                This automation has branches or waits — only the Visual editor can fully edit
                it. Switch to Visual above.
              </div>
            ) : (
              <div className="mx-auto max-w-2xl">
                <AutomationForm
                  mode="edit"
                  inline
                  initial={initial}
                  stages={stages}
                  tags={tags}
                  dispositions={dispositions}
                  onCancel={() => router.push('/workflows')}
                  onSave={async (values) => {
                    const res = await updateAutomation({ id: initial.id, ...values });
                    if (!res.ok) return res.error;
                    setName(values.name.trim());
                    router.refresh();
                    return null;
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
