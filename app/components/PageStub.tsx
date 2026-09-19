type Props = {
  title: string;
  description: string;
};

export default function PageStub({ title, description }: Props) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 p-10 text-center">
      <h1 className="text-2xl font-bold text-slate-200">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
        {description}
      </p>
      <span className="mt-5 rounded-full bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-400">
        Coming next
      </span>
    </div>
  );
}
