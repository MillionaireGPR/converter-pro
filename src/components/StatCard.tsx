import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
}

export function StatCard({ title, value, icon: Icon, trend, trendUp }: StatCardProps) {
  return (
    <Card className="shadow-card hover:shadow-card-hover transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {trend && (
              <p className={`text-xs font-medium ${trendUp ? 'text-success' : 'text-destructive'}`}>
                {trend}
              </p>
            )}
          </div>
          <div className="p-2.5 rounded-xl bg-accent">
            <Icon className="h-5 w-5 text-accent-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
