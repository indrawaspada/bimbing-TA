import Thread from "./Thread";
export default function DiscussionTab({ projectId }: { projectId: string }) {
  return (
    <div className="max-w-3xl">
      <h2 className="mb-3 text-lg font-bold">Diskusi proyek</h2>
      <Thread projectId={projectId} />
    </div>
  );
}
