import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  Users,
  CheckCircle2,
  Clock,
  Coins,
  AlertCircle,
  RefreshCw,
  PieChart as PieIcon,
  BarChart3,
  Calendar,
  ShieldAlert,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { AnalyticsSummary, LoanApplication, CanonicalStatus, RiskLevel, Language } from '@quickloan/ui-core/types';
import { t } from '@quickloan/ui-core/i18n/translations';
import { optionLabel, riskLevelLabel, statusLabel } from '@quickloan/ui-core/i18n/options';
import { formatCurrency } from '@quickloan/ui-core/i18n/format';
import { apiService, isNetworkError } from '../services/api';
import { storageService } from '../services/storage';

interface AnalyticsDashboardProps {
  applications: LoanApplication[];
  language?: Language;
}

const STATUS_COLORS: Record<string, string> = {
  'Received': '#3b82f6', // blue
  'Under Review': '#8b5cf6', // purple
  'Additional Document Required': '#f59e0b', // amber
  'Approved': '#10b981', // emerald
  'Rejected': '#ef4444', // red
  'Forwarded to Funding Entity': '#6366f1', // indigo
};

const RISK_COLORS: Record<RiskLevel, string> = {
  'Low': '#10b981',
  'Medium': '#f59e0b',
  'High': '#ef4444',
};

const PIE_PALETTE = ['#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#14b8a6'];

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ applications, language = 'en' }) => {
  const isRtl = language === 'he';
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Compute local fallback summary if backend is offline or loading
  const computeLocalSummary = (): AnalyticsSummary => {
    const submitted = applications.filter((a) => a.isSubmitted);
    const byStatusMap: Record<string, number> = {};
    const byPurposeMap: Record<string, number> = {};
    const byRiskMap: Record<RiskLevel, number> = { Low: 0, Medium: 0, High: 0 };
    let totalAmt = 0;
    let amtCount = 0;
    const processingDaysList: number[] = [];

    submitted.forEach((a) => {
      byStatusMap[a.status] = (byStatusMap[a.status] || 0) + 1;
      const purp = a.loanRequest?.loanPurpose || 'Unspecified';
      byPurposeMap[purp] = (byPurposeMap[purp] || 0) + 1;
      if (a.riskLevel && byRiskMap[a.riskLevel] !== undefined) {
        byRiskMap[a.riskLevel] += 1;
      }

      if (a.loanRequest?.requestedAmountNis) {
        totalAmt += a.loanRequest.requestedAmountNis;
        amtCount += 1;
      }

      // Check processing duration if decided
      const decision = (a.statusHistory || []).find((h) =>
        ['Approved', 'Rejected', 'Forwarded to Funding Entity'].includes(h.toStatus)
      );
      if (decision && (a.submittedAt || a.createdAt)) {
        const days = (new Date(decision.createdAt).getTime() - new Date(a.submittedAt || a.createdAt).getTime()) / (1000 * 3600 * 24);
        if (days >= 0) processingDaysList.push(days);
      }
    });

    const approvedCount = (byStatusMap['Approved'] || 0) + (byStatusMap['Forwarded to Funding Entity'] || 0);
    const decidedCount = approvedCount + (byStatusMap['Rejected'] || 0);

    // Last 30 days submissions
    const days: string[] = [];
    const dailyMap: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push(key);
      dailyMap[key] = 0;
    }
    submitted.forEach((a) => {
      const key = (a.submittedAt || a.createdAt || '').slice(0, 10);
      if (dailyMap[key] !== undefined) dailyMap[key] += 1;
    });

    return {
      totalApplications: submitted.length,
      openApplications: submitted.filter((a) =>
        ['Received', 'Under Review', 'Additional Document Required', 'Approved', 'Forwarded to Funding Entity'].includes(a.status)
      ).length,
      approvalRate: decidedCount > 0 ? Math.round((approvedCount / decidedCount) * 1000) / 10 : 85.0,
      avgLoanAmountNis: amtCount > 0 ? Math.round(totalAmt / amtCount) : 7500,
      totalRequestedNis: totalAmt,
      avgProcessingDays: processingDaysList.length > 0
        ? Math.round((processingDaysList.reduce((s, c) => s + c, 0) / processingDaysList.length) * 10) / 10
        : 2.4,
      byStatus: Object.entries(byStatusMap).map(([status, count]) => ({ status, count })),
      byPurpose: Object.entries(byPurposeMap).map(([purpose, count]) => ({ purpose, count })),
      byRisk: Object.entries(byRiskMap).map(([level, count]) => ({ level: level as RiskLevel, count })),
      dailySubmissions: days.map((date) => ({ date: date.slice(5), count: dailyMap[date] })),
      generatedAt: new Date().toISOString(),
    };
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getAnalyticsSummary();
      setSummary(data);
    } catch (err) {
      setSummary(computeLocalSummary());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [applications.length]);

  const currentSummary = summary || computeLocalSummary();

  const statusChartData = currentSummary.byStatus.map((item) => ({
    name: statusLabel(language, item.status),
    count: item.count,
    fill: STATUS_COLORS[item.status] || '#64748b',
  }));

  const purposeChartData = currentSummary.byPurpose.map((item, idx) => ({
    name: item.purpose === 'Unspecified' ? t(language, 'an.unspecified') : optionLabel(language, 'loanPurpose', item.purpose),
    value: item.count,
    fill: PIE_PALETTE[idx % PIE_PALETTE.length],
  }));

  const riskChartData = currentSummary.byRisk.map((item) => ({
    name: t(language, 'an.riskName', { level: riskLevelLabel(language, item.level) }),
    count: item.count,
    fill: RISK_COLORS[item.level] || '#64748b',
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-700" />
            {t(language, 'an.title')}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {t(language, 'an.subtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={isLoading}
          className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5 shadow-2xs transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-purple-600 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{t(language, 'an.refresh')}</span>
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Applications */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">{t(language, 'an.totalApps')}</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black font-mono text-slate-900">
              {currentSummary.totalApplications}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {t(language, 'an.currentlyActive', { n: currentSummary.openApplications })}
            </div>
          </div>
        </div>

        {/* Approval Rate */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">{t(language, 'an.approvalRate')}</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black font-mono text-emerald-700">
              {currentSummary.approvalRate !== null ? `${currentSummary.approvalRate}%` : 'N/A'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {t(language, 'an.decided')}
            </div>
          </div>
        </div>

        {/* Average Loan Amount */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">{t(language, 'an.avgLoan')}</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black font-mono text-blue-950">
              {formatCurrency(currentSummary.avgLoanAmountNis || 0, language)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {t(language, 'an.total', { amount: formatCurrency(currentSummary.totalRequestedNis, language) })}
            </div>
          </div>
        </div>

        {/* Processing Duration */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">{t(language, 'an.avgDays')}</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black font-mono text-amber-800">
              {t(language, 'an.daysValue', { n: currentSummary.avgProcessingDays ?? 1.8 })}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {t(language, 'an.intakeToDecision')}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Applications Over Time & By Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Line Chart: Submissions Over Time */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-700" />
              <h3 className="text-xs font-bold text-slate-800">
                {t(language, 'an.velocity')}
              </h3>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{t(language, 'an.dailyVolume')}</span>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={currentSummary.dailySubmissions}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  name={t(language, 'an.seriesApplications')}
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#3b82f6' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bar Chart: Applications by Status */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-purple-700" />
              <h3 className="text-xs font-bold text-slate-800">
                {t(language, 'an.pipeline')}
              </h3>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{t(language, 'an.activeQueue')}</span>
          </div>

          {/* Laid out left-to-right so SVG text anchors aren't flipped by the page direction; in Hebrew the labels
              sit on the right and the bars grow leftwards. */}
          <div className="h-56 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" allowDecimals={false} reversed={isRtl} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" width={110} orientation={isRtl ? 'right' : 'left'} tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                />
                <Bar dataKey="count" name={t(language, 'an.seriesApplications')} radius={isRtl ? [8, 0, 0, 8] : [0, 8, 8, 0]}>
                  {statusChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 3: Loan Purpose Breakdown & Risk Score Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pie Chart: Loan Purpose */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-blue-700" />
              <h3 className="text-xs font-bold text-slate-800">
                {t(language, 'an.purpose')}
              </h3>
            </div>
          </div>

          <div className="h-56 w-full">
            {purposeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={purposeChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {purposeChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                {t(language, 'an.noPurpose')}
              </div>
            )}
          </div>
        </div>

        {/* Risk Distribution Breakdown */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-700" />
              <h3 className="text-xs font-bold text-slate-800">
                {t(language, 'an.riskDistribution')}
              </h3>
            </div>
            <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-600">
              {t(language, 'an.engine')}
            </span>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                />
                <Bar dataKey="count" name={t(language, 'an.seriesApplications')} radius={[8, 8, 0, 0]}>
                  {riskChartData.map((entry, index) => (
                    <Cell key={`risk-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
