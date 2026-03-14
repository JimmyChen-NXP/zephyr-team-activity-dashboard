"use client";

import { formatISO9075 } from "date-fns";

import type { ActivityItem } from "@/lib/types";

type AuthoredPrsTableProps = {
  items: ActivityItem[];
};

export function AuthoredPrsTable({ items }: AuthoredPrsTableProps) {
  return (
    <section className="panel table-panel detail-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Authored PRs</p>
          <h2>Pull request activity</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PR</th>
              <th>State</th>
              <th>Updated</th>
              <th>Repository</th>
              <th>Contributor</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state-cell">
                  No authored PRs matched the current selection.
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
                  <td>{item.statusLabel}</td>
                  <td>{formatISO9075(new Date(item.updatedAt))}</td>
                  <td>{item.repo}</td>
                  <td>@{item.contributor}</td>
                  <td>{formatISO9075(new Date(item.createdAt))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
