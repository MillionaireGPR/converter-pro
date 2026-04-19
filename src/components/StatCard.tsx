import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  accent?: boolean;
}

export function StatCard({ title, value, icon: Icon, trend, trendUp, accent }: StatCardProps) {
  return (
    <Card className={cn(
      "shadow-card hover:shadow-card-hover transition-all duration-300 group overflow-hidden relative",
      accent && "border-primary/20"
    )}>
      {accent && (
        <div className="absolute inset-0 gradient-primary opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" />
      )}
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-extrabold text-foreground tracking-tight">{value}</p>
            {trend && (
              <div className={cn(
                "flex items-center gap-1 text-xs font-medium",
                trendUp ? 'text-success' : 'text-muted-foreground'
              )}>
                {trendUp !== undefined && (
                  trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />
                )}
                <span>{trend}</span>
              </div>
            )}
          </div>
          <div className={cn(
            "p-3 rounded-xl transition-colors duration-300",
            accent ? "gradient-primary" : "bg-accent group-hover:bg-primary/10"
          )}>
            <Icon className={cn(
              "h-5 w-5 transition-colors duration-300",
              accent ? "text-primary-foreground" : "text-accent-foreground group-hover:text-primary"
            )} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
