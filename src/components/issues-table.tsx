"use client";

import { formatISO9075 } from "date-fns";

import type { ActivityItem } from "@/lib/types";

type IssuesTableProps = {
  items: ActivityItem[];
};

export function IssuesTable({ items }: IssuesTableProps) {
  return (
    <section className="panel table-panel detail-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Assigned issues</p>
          <h2>Issue activity</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Issue</th>
              <th>Repository</th>
              <th>Contributor</th>
              <th>State</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state-cell">
                  No issues matched the current selection.
                </td>
              </tr>
            ) : (
              items.slice(0, 40).map((item) => (
                <tr key={item.id}>
                  <td>
                    <a href={item.url} target="_blank" rel="noreferrer" className="table-link">
                      {item.title}
                    </a>
                  </td>
                  <td>{item.repo}</td>
                  <td>@{item.contributor}</td>
                  <td>{item.statusLabel}</td>
                  <td>{formatISO9075(new Date(item.updatedAt))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
