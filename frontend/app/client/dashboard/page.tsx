import AppShell from "@/components/layout/app-shell";
import DashboardShared from "@/components/DashboardShared";
import NoActiveActivationBanner from "@/components/NoActiveActivationBanner";

export default function ClientDashboard() {
  return (
    <AppShell>
      <NoActiveActivationBanner />
      <DashboardShared />
    </AppShell>
  );
}
