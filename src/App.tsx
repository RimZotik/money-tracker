import {
  ChartPie,
  CreditCard,
  Landmark,
  List,
  PiggyBank,
  Plus,
  Rocket,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import TxModal from "./components/TxModal";
import Accounts from "./pages/Accounts";
import Credits from "./pages/Credits";
import Dashboard from "./pages/Dashboard";
import Deposits from "./pages/Deposits";
import Projects from "./pages/Projects";
import Settings from "./pages/Settings";
import Transactions from "./pages/Transactions";
import { StoreProvider } from "./store";

const NAV: { to: string; icon: LucideIcon; label: string; end?: boolean }[] = [
  { to: "/", icon: ChartPie, label: "Дашборд", end: true },
  { to: "/transactions", icon: List, label: "Операции" },
  { to: "/accounts", icon: CreditCard, label: "Счета" },
  { to: "/credits", icon: Landmark, label: "Кредиты" },
  { to: "/deposits", icon: PiggyBank, label: "Вклады" },
  { to: "/projects", icon: Rocket, label: "Проекты" },
  { to: "/settings", icon: SettingsIcon, label: "Настройки" },
];

function Shell() {
  const [newTx, setNewTx] = useState(false);
  // Счётчик говорит страницам «данные изменились, перечитайте себя».
  const [saved, setSaved] = useState(0);

  // Ctrl+N — быстро создать операцию, не отрывая рук от клавиатуры.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && ev.key.toLowerCase() === "n") {
        ev.preventDefault();
        setNewTx(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo">
          Money<span>Tracker</span>
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <n.icon size={17} className="ico" />
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <button className="btn primary" onClick={() => setNewTx(true)}>
          <Plus size={16} />
          Операция
        </button>
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: 11,
            textAlign: "center",
            marginTop: 8,
          }}
        >
          Ctrl + N
        </div>
      </nav>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard key={saved} />} />
          <Route path="/transactions" element={<Transactions key={saved} />} />
          <Route path="/accounts" element={<Accounts key={saved} />} />
          <Route path="/credits" element={<Credits key={saved} />} />
          <Route path="/deposits" element={<Deposits key={saved} />} />
          <Route path="/projects" element={<Projects key={saved} />} />
          <Route path="/settings" element={<Settings key={saved} />} />
        </Routes>
      </main>

      {newTx && (
        <TxModal onClose={() => setNewTx(false)} onSaved={() => setSaved((s) => s + 1)} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
