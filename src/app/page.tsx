import Scanner from "@/components/Scanner";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <p className="text-xs font-semibold tracking-[0.18em] text-indigo-600 uppercase">Cerebro</p>
      <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance text-slate-900">
        See where your brand was mentioned this month
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-600">
        Type a brand name. Cerebro checks news sites, Reddit and YouTube for the last 30 days and
        lists what it finds, newest first. Free, no sign-up.
      </p>
      <Scanner />
      <p className="mt-10 text-xs text-slate-400">
        Built by{" "}
        <a className="underline hover:text-slate-600" href="https://aashishkarki.com/projects">
          Aashish Karki
        </a>
        .
      </p>
    </main>
  );
}
