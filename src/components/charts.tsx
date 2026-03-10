"use client";

import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DashboardView } from "@/lib/dashboard-views";
import type { RepoActivity, ReviewOutcomeBreakdown, ReviewSourceBreakdown } from "@/lib/types";

type ChartsProps = {
  view: DashboardView;
  repos: RepoActivity[];
  reviewOutcomes: ReviewOutcomeBreakdown;
  reviewSources: ReviewSourceBreakdown;
  summaryHighlights: Array<{ label: string; value: number | string }>;
};

const COLORS = ["#7c3aed", "#38bdf8", "#f97316", "#10b981"];

export function DashboardCharts({ view, repos, reviewOutcomes, reviewSources, summaryHighlights }: ChartsProps) {
  const repoData = repos.slice(0, 6).map((repo) => ({
    name: repo.name.replace("zephyrproject-rtos/", ""),
    activity: repo.prs + repo.reviews + repo.issues,
  }));

  const reviewData = [
    { name: "Team PR", value: reviewSources.teamPr },
    { name: "External PR", value: reviewSources.extPr },
  ].filter((item) => item.value > 0);

  const outcomeCards = [
    { label: "Approved", value: reviewOutcomes.approved },
    { label: "Changes requested", value: reviewOutcomes.changesRequested },
    { label: "Commented", value: reviewOutcomes.commented },
  ];

  const metricPanelTitle = view === "issues" ? "Issue signals" : view === "pull-requests" ? "PR signals" : "Review split";
  const metricPanelSubtitle =
    view === "issues"
      ? "Issue-only highlights for the active filters"
      : view === "pull-requests"
        ? "PR-only highlights for the active filters"
        : "Team PR vs external PR";

  return (
    <div className="chart-grid">
      <section className="panel chart-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Repository concentration</p>
            <h3>Where the team is spending time</h3>
          </div>
        </div>
        <div className="chart-frame">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={repoData} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#b8c2d9", fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "#7f8aa3", fontSize: 12 }} />
              <Tooltip cursor={{ fill: "rgba(124, 58, 237, 0.08)" }} contentStyle={{ background: "#111827", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: 16 }} />
              <Bar dataKey="activity" radius={[12, 12, 0, 0]} fill="#7c3aed" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel chart-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{metricPanelTitle}</p>
            <h3>{metricPanelSubtitle}</h3>
          </div>
        </div>
        {view === "reviews" ? (
          <div className="chart-frame donut-frame">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={reviewData} dataKey="value" nameKey="name" innerRadius={68} outerRadius={110} paddingAngle={4}>
                  {reviewData.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: 16 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="review-side-panel">
              <ul className="legend-list">
                {reviewData.map((entry, index) => (
                  <li key={entry.name}>
                    <span className="legend-dot" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <span>{entry.name}</span>
                    <strong>{entry.value}</strong>
                  </li>
                ))}
              </ul>
              <div className="mini-metric-grid">
                {outcomeCards.map((card) => (
                  <article key={card.label} className="mini-metric-card">
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="chart-frame highlight-panel">
            <div className="mini-metric-grid highlight-grid">
              {summaryHighlights.map((card) => (
                <article key={card.label} className="mini-metric-card">
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
