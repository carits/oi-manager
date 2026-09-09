"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageFrame } from "@/components/ui/PageFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import {
  TableRoot,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/TablePrimitives";
import { apiClient } from "@/lib/apiClient";
import {
  contributionRewardPresentation,
  contributionScoreLabel,
  contributionStatusPresentation,
  contributionTypeLabel,
} from "./contribution-display";
import styles from "./ContributionPage.module.css";

type Summary = { eventCount: number; contributionScore: number; level: string };
type Event = {
  id: string;
  type: string;
  sourceType: string;
  score: number;
  status: string;
  occurredAt: string;
  displayAt?: string;
  acceptedAt: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  Attribution?: {
    organizationId: string;
    Organization?: { name: string } | null;
  } | null;
  RewardDelivery?: { status: string; userCarits: string } | null;
};
type EventPage = {
  items: Event[];
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
};

export function ContributionPage() {
  const [summary, setSummary] = useState<Summary | null>(null),
    [events, setEvents] = useState<Event[]>([]),
    [eventsLoaded, setEventsLoaded] = useState(false),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [total, setTotal] = useState(0),
    [totalPages, setTotalPages] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    const [summaryResult, eventResult] = await Promise.all([
      apiClient.get<Summary>("/api/contributions/me/summary", {
        accountScoped: true,
      }),
      apiClient.get<EventPage>(
        `/api/contributions/me/events?page=${page}&pageSize=${pageSize}`,
        { accountScoped: true },
      ),
    ]);
    if (sequence !== requestSequence.current) return;
    const errors: string[] = [];
    if (summaryResult.success && summaryResult.data)
      setSummary(summaryResult.data);
    else {
      setSummary(null);
      errors.push(summaryResult.message || "贡献摘要加载失败");
    }
    if (eventResult.success && eventResult.data) {
      setEvents(eventResult.data.items);
      setEventsLoaded(true);
      setTotal(eventResult.data.total ?? eventResult.data.items.length);
      setTotalPages(
        eventResult.data.totalPages ??
          Math.ceil((eventResult.data.total ?? eventResult.data.items.length) / pageSize),
      );
    } else {
      setEvents([]);
      setEventsLoaded(false);
      setTotal(0);
      setTotalPages(0);
      errors.push(eventResult.message || "贡献记录加载失败");
    }
    setError([...new Set(errors)].join("；"));
    setLoading(false);
  }, [page, pageSize]);
  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);
  return (
    <PageFrame width="reading">
      <div className={styles.stack}>
        <PageHeader
          title="我的贡献"
          description="贡献值是不可消费的声誉；正式测试数据被采用后才会获得贡献值和 Carits币。"
        />
        <div className={styles.summary}>
          <article>
            <span>贡献等级</span>
            <strong>{summary?.level || "—"}</strong>
          </article>
          <article>
            <span>贡献值</span>
            <strong>{summary ? summary.contributionScore : "—"}</strong>
          </article>
          <article>
            <span>已采纳贡献</span>
            <strong>{summary ? summary.eventCount : "—"}</strong>
          </article>
        </div>
        {error && (
          <div className={styles.loadError} role="alert">
            <span>{error}</span>
            <Button size="sm" variant="outline" loading={loading} onClick={() => void load()}>
              重新加载
            </Button>
          </div>
        )}
        <div className={styles.tableWrap}>
          {eventsLoaded && events.length ? (
            <TableRoot>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>时间</TableHeaderCell>
                  <TableHeaderCell>类型</TableHeaderCell>
                  <TableHeaderCell>状态</TableHeaderCell>
                  <TableHeaderCell>贡献归属</TableHeaderCell>
                  <TableHeaderCell>贡献值</TableHeaderCell>
                  <TableHeaderCell>Carits 奖励</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.displayAt || item.acceptedAt || item.occurredAt
                        ? new Date(item.displayAt || item.acceptedAt || item.occurredAt).toLocaleString("zh-CN")
                        : "时间待补录"}
                    </TableCell>
                    <TableCell>{contributionTypeLabel(item.type)}</TableCell>
                    <TableCell>
                      <span className={styles.statusCell}>
                        <StatusBadge variant={contributionStatusPresentation(item.status).variant}>
                          {contributionStatusPresentation(item.status).label}
                        </StatusBadge>
                        {item.revokeReason && <small>{item.revokeReason}</small>}
                      </span>
                    </TableCell>
                    <TableCell>{item.Attribution?.Organization?.name || "个人贡献"}</TableCell>
                    <TableCell>{contributionScoreLabel(item.status, item.score)}</TableCell>
                    <TableCell>
                      <StatusBadge
                        variant={contributionRewardPresentation(item.status, item.RewardDelivery).variant}
                      >
                        {contributionRewardPresentation(item.status, item.RewardDelivery).label}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </TableRoot>
          ) : loading ? (
            <p className={styles.empty}>正在加载贡献记录…</p>
          ) : eventsLoaded ? (
            <p className={styles.empty}>暂无贡献记录</p>
          ) : (
            <p className={styles.empty}>贡献记录暂时无法显示，请重新加载。</p>
          )}
        </div>
        {eventsLoaded && total > 0 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
            pageSizeOptions={[10, 20, 50, 100]}
          />
        )}
      </div>
    </PageFrame>
  );
}
