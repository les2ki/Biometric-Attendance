import type { ReactNode } from "react"; // children types

interface PageHeaderProps { // the top of every page
  title: ReactNode; // h1 text
  subtitle?: ReactNode; // one line under the title
  actions?: ReactNode; // buttons on the right
  breadcrumb?: ReactNode; // optional trail above the title
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: PageHeaderProps) { // left-biased title, actions right (wrap on mobile)
  return (
    // header row: title block grows, actions wrap underneath on narrow screens
    <header className="flex flex-col gap-4 border-b border-rule pb-5 md:flex-row md:items-end md:justify-between">
      {/* title block */}
      <div className="min-w-0 space-y-1.5">
        {breadcrumb}
        <h1 className="text-2xl font-semibold leading-tight md:text-[1.75rem]">{title}</h1>
        {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {/* actions */}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
