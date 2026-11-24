// Icons come from lucide (the set shadcn uses), sized to the text around them. Each agent shows its
// own logo.
import { type LucideProps } from "lucide-react";
import { AgentMark } from "../../shared/AgentMark";
import type { Status } from "../../src/core/types";
import type { Tool } from "../../src/core/agents";
import { STATUS_LABEL } from "../lib/format";

export {
  Activity,
  ArrowUpRight,
  Eraser,
  Keyboard,
  Scan,
  ListFilter,
  Folder,
  FolderOpen,
  FolderTree,
  FolderX,
  SearchX,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Network,
  Check,
  ChevronRight,
  Clock,
  Coins,
  ExternalLink,
  GitBranch,
  Inbox,
  LayoutGrid,
  Link2,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Eye,
  LayoutDashboard,
  MessageSquareDot,
  Minimize2,
  Search,
  SquareTerminal,
  Unlink,
  X,
  Zap,
} from "lucide-react";

/** Default props for an icon inline with text. */
export const I: LucideProps = { size: 14, strokeWidth: 2, "aria-hidden": true };

/** The agent's logo, `size` pixels square. */
export function ToolMark({ tool, size = 16 }: { tool: Tool; size?: number }) {
  return <AgentMark agent={tool} className="toolmark" style={{ fontSize: size }} label={tool} />;
}

export function StatusDot({ status }: { status: Status }) {
  return <span className={`dot ${status}`} role="img" aria-label={STATUS_LABEL[status]} />;
}

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`statuschip ${status}`}>
      <span className={`dot ${status}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
