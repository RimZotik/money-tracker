import {
  ArrowLeftRight,
  Banknote,
  Bitcoin,
  Briefcase,
  Bus,
  ChartPie,
  CreditCard,
  Dumbbell,
  Film,
  Gamepad2,
  GraduationCap,
  Handshake,
  HelpCircle,
  Home,
  Landmark,
  Laptop,
  type LucideIcon,
  Package,
  Percent,
  Pill,
  Receipt,
  Repeat,
  Rocket,
  Shirt,
  ShoppingCart,
  Smartphone,
  Undo2,
  Users,
  Utensils,
  Wallet,
  Wrench,
  PiggyBank,
  TrendingUp,
  Dices,
} from "lucide-react";

/**
 * В базе у категорий и счетов хранится ИМЯ иконки, а не сам компонент.
 * Здесь имя превращается в компонент. Новую иконку добавлять сюда.
 */
const ICONS: Record<string, LucideIcon> = {
  // Категории расходов
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  bus: Bus,
  laptop: Laptop,
  "gamepad-2": Gamepad2,
  repeat: Repeat,
  pill: Pill,
  shirt: Shirt,
  home: Home,
  film: Film,
  percent: Percent,
  users: Users,
  receipt: Receipt,
  dumbbell: Dumbbell,
  wrench: Wrench,
  "piggy-bank": PiggyBank,
  "trending-up": TrendingUp,
  dices: Dices,

  // Категории доходов
  "graduation-cap": GraduationCap,
  briefcase: Briefcase,
  rocket: Rocket,
  handshake: Handshake,
  "undo-2": Undo2,

  // Счета
  landmark: Landmark,
  "credit-card": CreditCard,
  bitcoin: Bitcoin,
  banknote: Banknote,
  wallet: Wallet,

  // Навигация и прочее
  "chart-pie": ChartPie,
  "arrow-left-right": ArrowLeftRight,
  smartphone: Smartphone,
  package: Package,
  "help-circle": HelpCircle,
};

interface Props {
  name: string | null | undefined;
  size?: number;
  color?: string;
  className?: string;
}

export default function Icon({ name, size = 16, color, className }: Props) {
  const Cmp = (name && ICONS[name]) || HelpCircle;
  return <Cmp size={size} color={color} className={className} strokeWidth={2} aria-hidden />;
}

export { ICONS };
