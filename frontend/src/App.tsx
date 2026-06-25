import { Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/require-auth'
import { RequireRole } from './auth/require-role'
import { AppShell } from './components/app-shell'
import { BiHomePage } from './pages/bi-home'
import { CatalogPage } from './pages/catalog'
import { ChartBuilderPage } from './pages/chart-builder'
import { DashboardPage } from './pages/dashboard'
import { DashboardBuilderPage } from './pages/dashboard-builder'
import { DashboardViewerPage } from './pages/dashboard-viewer'
import { DatasetsPage } from './pages/datasets'
import { EngineLabPage } from './pages/engine-lab'
import { FileExplorerPage } from './pages/files'
import { JobLogsPage } from './pages/logs'
import { MetricsPage } from './pages/metrics'
import { PipelineBuilderPage } from './pages/pipelines'
import { PipelineRunsPage } from './pages/runs'
import { ReportSchedulerPage } from './pages/report-scheduler'
import { SavedChartsPage } from './pages/saved-charts'
import { SettingsPage } from './pages/settings'
import { SqlWorkspacePage } from './pages/sql-workspace'
import { SupersetSetupPage } from './pages/superset'
import { LoginPage } from './pages/login'
import { OpenLineagePage } from './pages/openlineage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/files" element={<FileExplorerPage />} />
          <Route path="/sql" element={<SqlWorkspacePage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/runs" element={<PipelineRunsPage />} />
          <Route path="/logs" element={<JobLogsPage />} />
          <Route path="/lineage-events" element={<OpenLineagePage />} />
          <Route path="/bi" element={<BiHomePage />} />
          <Route path="/bi/charts" element={<SavedChartsPage />} />
          <Route path="/bi/dashboards" element={<DashboardViewerPage />} />
          <Route path="/bi/superset" element={<SupersetSetupPage />} />
          <Route element={<RequireRole roles={['admin', 'analyst']} />}>
            <Route path="/engines" element={<EngineLabPage />} />
            <Route path="/pipelines" element={<PipelineBuilderPage />} />
            <Route path="/bi/datasets" element={<DatasetsPage />} />
            <Route path="/bi/metrics" element={<MetricsPage />} />
            <Route path="/bi/charts/new" element={<ChartBuilderPage />} />
            <Route path="/bi/dashboards/new" element={<DashboardBuilderPage />} />
            <Route path="/bi/reports" element={<ReportSchedulerPage />} />
          </Route>
          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}

export default App
