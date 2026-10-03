"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Baby, BookOpen, Calculator, CheckCircle2, ChevronRight, Droplets, Heart,
  Layers, MapPin, Package, Pencil, Plus, Minus, RotateCcw, Trash2,
  ShirtIcon, ShoppingBag, Soup, Sparkles, Truck, User, Users, Utensils, Wallet, Warehouse,
} from "lucide-react";
import { Button, Card, Field, Input, LevelBadge, PageHeader, Select, Textarea } from "@/components/ui";
import { ModelNeeds, ModelPlan, api } from "@/lib/api";
import { errorText, useDonor } from "@/lib/auth";
import { DISTRICTS, DropoffPoint, ItemKey, ITEMS, distanceKm } from "@/lib/data";
import { fmt, suggestAllocation } from "@/lib/needs";
import { useApp } from "@/lib/store";

type DonationCategory = ItemKey | "money";

const CATEGORIES = [
  {
    key: "food" as DonationCategory,
    label: "Food Packs",
    description: "Rice, dhal, canned fish & dry rations",
    unit: "packs",
    icon: <Utensils size={28} />,
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
    minQty: 1,
    defaultQty: 0,
  },
  {
    key: "clothes" as DonationCategory,
    label: "Clothes",
    description: "Baby, children, youth & elder sets",
    unit: "sets",
    icon: <ShirtIcon size={28} />,
    color: "text-sky-600",
    bg: "bg-sky-50",
    border: "border-sky-200",
    minQty: 1,
    defaultQty: 0,
  },
  {
    key: "books" as DonationCategory,
    label: "Books & Supplies",
    description: "School bags, school books, pens, pencils & copies",
    unit: "books",
    icon: <BookOpen size={28} />,
    color: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-200",
    minQty: 1,
    defaultQty: 0,
  },
  {
    key: "money" as DonationCategory,
    label: "Money Donation",
    description: "Fund allocated to highest-need area",
    unit: "LKR",
    icon: <Wallet size={28} />,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    minQty: 100,
    defaultQty: 5000,
  },
];

export interface SubItemDef {
  id: string;
  name: string;
  unit: string;
  desc: string;
  tag: string;
  weight: number;      // contribution factor to standard category pack/unit
  step: number;
  defaultVal: number;
  icon: React.ReactNode;
}

const SUB_ITEMS: Record<Exclude<DonationCategory, "money">, SubItemDef[]> = {
  food: [
    {
      id: "rice_2kg",
      name: "Rice (2 kg bag)",
      unit: "bags",
      desc: "Samba, Nadu, or Kakulu white/red rice",
      tag: "Staple",
      weight: 0.5, // 2 bags = 1 standard family pack
      step: 2,
      defaultVal: 0,
      icon: <Layers size={18} className="text-amber-600" />,
    },
    {
      id: "rice_5kg",
      name: "Rice (5 kg bag)",
      unit: "bags",
      desc: "Large family staple ration sack",
      tag: "Staple",
      weight: 1.25,
      step: 1,
      defaultVal: 0,
      icon: <Layers size={18} className="text-amber-700" />,
    },
    {
      id: "water_bottles",
      name: "Drinking Water (1.5L / 1L)",
      unit: "bottles",
      desc: "Sealed clean drinking water bottles",
      tag: "Hydration",
      weight: 0.2, // 5 bottles = 1 pack quota
      step: 6,
      defaultVal: 0,
      icon: <Droplets size={18} className="text-sky-600" />,
    },
    {
      id: "dhal_lentils",
      name: "Dhal / Red Lentils (1 kg)",
      unit: "packs",
      desc: "Essential high-protein legume",
      tag: "Protein",
      weight: 0.25,
      step: 2,
      defaultVal: 0,
      icon: <Soup size={18} className="text-orange-600" />,
    },
    {
      id: "canned_food",
      name: "Canned Fish / Tinned Food",
      unit: "tins",
      desc: "Ready-to-eat canned fish or meat",
      tag: "Ready-to-eat",
      weight: 0.25,
      step: 2,
      defaultVal: 0,
      icon: <Package size={18} className="text-rose-600" />,
    },
    {
      id: "dry_rations",
      name: "Biscuits, Tea & Dry Rations",
      unit: "packs",
      desc: "Energy biscuits, wheat flour & milk packets",
      tag: "Dry Goods",
      weight: 0.25,
      step: 2,
      defaultVal: 0,
      icon: <Utensils size={18} className="text-amber-600" />,
    },
    {
      id: "food_box",
      name: "Full Pre-assembled Food Box",
      unit: "boxes",
      desc: "Complete emergency family ration kit",
      tag: "Full Kit",
      weight: 1.0,
      step: 1,
      defaultVal: 0,
      icon: <ShoppingBag size={18} className="text-emerald-600" />,
    },
  ],
  clothes: [
    {
      id: "baby_clothes",
      name: "Baby & Infant Clothes (0 - 2 yrs)",
      unit: "sets",
      desc: "Baby rompers, nappies, vests & baby suits",
      tag: "Infants",
      weight: 1.0,
      step: 2,
      defaultVal: 0,
      icon: <Baby size={18} className="text-pink-600" />,
    },
    {
      id: "kids_clothes",
      name: "Children & Kids Clothes (3 - 12 yrs)",
      unit: "sets",
      desc: "Shirts, shorts, tops, skirts & everyday sets",
      tag: "Kids",
      weight: 1.0,
      step: 2,
      defaultVal: 0,
      icon: <User size={18} className="text-blue-600" />,
    },
    {
      id: "youth_clothes",
      name: "Youth & Teen Clothes (13 - 18 yrs)",
      unit: "sets",
      desc: "T-shirts, shirts, trousers & casual wear",
      tag: "Teens",
      weight: 1.0,
      step: 2,
      defaultVal: 0,
      icon: <Users size={18} className="text-indigo-600" />,
    },
    {
      id: "adult_clothes",
      name: "Adult & Elder Clothes",
      unit: "sets",
      desc: "Sarongs, sarees, shirts, pants & dhotis",
      tag: "Adults",
      weight: 1.0,
      step: 2,
      defaultVal: 0,
      icon: <ShirtIcon size={18} className="text-teal-600" />,
    },
    {
      id: "blankets_bedding",
      name: "Blankets, Bedding & Towels",
      unit: "items",
      desc: "Warm fleece blankets, bedsheets & towels",
      tag: "Bedding",
      weight: 1.0,
      step: 2,
      defaultVal: 0,
      icon: <Layers size={18} className="text-purple-600" />,
    },
  ],
  books: [
    {
      id: "school_books",
      name: "School Books",
      unit: "books",
      desc: "Text books, readers and workbooks for students",
      tag: "Books",
      weight: 1.0,
      step: 5,
      defaultVal: 0,
      icon: <BookOpen size={18} className="text-violet-600" />,
    },
    {
      id: "copies_120",
      name: "Copies (120 pages)",
      unit: "copies",
      desc: "Single-ruled, CR or square-ruled exercise books",
      tag: "Copies",
      weight: 1.0,
      step: 10,
      defaultVal: 0,
      icon: <Layers size={18} className="text-indigo-600" />,
    },
    {
      id: "school_bags",
      name: "School Bags",
      unit: "bags",
      desc: "Durable student school bags",
      tag: "School Bags",
      weight: 5.0, // 1 school bag = 5 supply units
      step: 1,
      defaultVal: 0,
      icon: <ShoppingBag size={18} className="text-amber-600" />,
    },
    {
      id: "stationery_kits",
      name: "Pen & Pencil Set",
      unit: "sets",
      desc: "Blue/black pens, pencils, eraser & ruler for one student",
      tag: "Stationery",
      weight: 2.0,
      step: 2,
      defaultVal: 0,
      icon: <Pencil size={18} className="text-blue-600" />,
    },
  ],
};

// One standard pack: what it contains and how many of the category's counting units that is
// (food and clothes are counted in packs / sets, books in supply units, 10 to a student pack).
const BOOK_PACK_UNITS = 10;
const PACKS: Record<Exclude<DonationCategory, "money">, { name: string; units: number; contents: string[]; note: string }> = {
  food: {
    name: "1 food pack",
    units: 1,
    contents: ["Rice 2 kg", "Dhal / red lentils 1 kg", "Canned fish 1 tin"],
    note: "One pack is dry rations for one family. Other food counts towards packs at the rate shown on each item.",
  },
  clothes: {
    name: "1 clothes set",
    units: 1,
    contents: ["1 top (shirt, T-shirt, blouse)", "1 bottom (trousers, skirt, sarong) or a saree / frock"],
    note: "One set is a full outfit for one person. A blanket, bedsheet or towel counts as one set.",
  },
  books: {
    name: "1 student pack",
    units: BOOK_PACK_UNITS,
    contents: ["1 School Bag", "1 School Book", "1 Pen & Pencil set", "2 Copies (120 pages)"],
    note: "One pack equips one student. If you give only some of these, they still count towards packs at the rate shown on each item.",
  },
};

/** "Each counts as 0.5 pack": how one of a sub-item counts towards the standard pack when given on its own. */
function packRate(catKey: Exclude<DonationCategory, "money">, sub: SubItemDef) {
  const packs = +(sub.weight / PACKS[catKey].units).toFixed(2);
  return `Each counts as ${packs} ${catKey === "clothes" ? "set" : "pack"}${packs > 1 ? "s" : ""}`;
}

interface OtherItem {
  name: string;
  amount: string;
}

function getDefaultSubItems(catKey: Exclude<DonationCategory, "money">): Record<string, number> {
  const defs = SUB_ITEMS[catKey] || [];
  const map: Record<string, number> = {};
  for (const d of defs) {
    map[d.id] = 0;
  }
  return map;
}

function computeSubItemsQty(
  catKey: Exclude<DonationCategory, "money">,
  items: Record<string, number>
): { totalQty: number; summary: string[]; totalPieces: number } {
  const defs = SUB_ITEMS[catKey] || [];
  let weightedSum = 0;
  let totalPieces = 0;
  const summary: string[] = [];

  for (const def of defs) {
    const count = items[def.id] || 0;
    if (count > 0) {
      weightedSum += count * def.weight;
      totalPieces += count;
      summary.push(`${def.name}: ${count} ${def.unit}`);
    }
  }

  const totalQty = Math.round(weightedSum);
  return { totalQty, summary, totalPieces };
}

export default function DonatePage() {
  return (
    <Suspense>
      <DonateFlow />
    </Suspense>
  );
}

function StepDots({ step }: { step: number }) {
  const labels = ["Choose", "Details", "Confirm"];
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-all ${
              i < step
                ? "bg-brand-600 text-white"
                : i === step
                ? "bg-brand-600 text-white shadow-md shadow-brand-200"
                : "bg-gray-100 text-ink-muted"
            }`}
          >
            {i < step ? <CheckCircle2 size={16} /> : i + 1}
          </div>
          <span className={`text-sm font-medium ${i === step ? "text-ink" : "text-ink-muted"}`}>
            {l}
          </span>
          {i < labels.length - 1 && <ChevronRight size={16} className="text-gray-300" />}
        </div>
      ))}
    </div>
  );
}

interface Place {
  key: string;
  ds: string;
  district: string;
  km: number;
  level: string;
  needs: number;
  qty: number;
  reason: string;
}

function DonateFlow() {
  const params = useSearchParams();
  const { mode, adjustments, confirmedAreas, addDonation } = useApp();
  const CURRENT_DONOR = useDonor();
  const presetItem = (params.get("item") as ItemKey) || null;

  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<DonationCategory | null>(presetItem);

  // Sub-items selection state and calculation mode
  const [calcMode, setCalcMode] = useState<"itemized" | "direct">("itemized");
  const [subItems, setSubItems] = useState<Record<string, number>>(() => {
    return presetItem ? getDefaultSubItems(presetItem) : {};
  });

  const [qty, setQty] = useState<number>(0);

  const packSize = BOOK_PACK_UNITS;
  // things the donor gives that are not in the list: typed in, not counted towards packs
  const [others, setOthers] = useState<OtherItem[]>([]);

  // how the items reach the organisation: a collector picks them up, or the donor brings them to a drop-off point
  const [handover, setHandover] = useState<"pickup" | "dropoff">("pickup");
  const [points, setPoints] = useState<DropoffPoint[]>([]);
  const [dropoffId, setDropoffId] = useState("");
  useEffect(() => {
    api.dropoffPoints().then(setPoints).catch(() => {}); // none loaded: only collector pickup is offered
  }, []);
  const [donorDistrict, setDonorDistrict] = useState(CURRENT_DONOR.district);
  const [name, setName] = useState(CURRENT_DONOR.name);
  const [phone, setPhone] = useState(CURRENT_DONOR.phone);
  const [email, setEmail] = useState(CURRENT_DONOR.email);
  const [address, setAddress] = useState(CURRENT_DONOR.address);
  const [pickupDate, setPickupDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("Morning (8am - 12pm)");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cat = CATEGORIES.find((c) => c.key === selected) ?? null;

  // Handle switching category
  const handleSelectCategory = (key: DonationCategory) => {
    setSelected(key);
    setOthers([]);
    if (key !== "money") {
      const defs = getDefaultSubItems(key as Exclude<DonationCategory, "money">);
      setSubItems(defs);
      setQty(0);
    } else {
      setQty(5000);
    }
  };

  // Update a sub-item quantity
  const handleUpdateSubItem = (id: string, newCount: number) => {
    if (!selected || selected === "money") return;
    const catKey = selected as Exclude<DonationCategory, "money">;
    const val = Math.max(0, newCount);
    const next = { ...subItems, [id]: val };
    setSubItems(next);
    if (calcMode === "itemized") {
      const { totalQty } = computeSubItemsQty(catKey, next);
      setQty(totalQty);
    }
  };

  // Reset sub-items to zero
  const handleClearSubItems = () => {
    if (!selected || selected === "money") return;
    const catKey = selected as Exclude<DonationCategory, "money">;
    const defs = SUB_ITEMS[catKey] || [];
    const cleared: Record<string, number> = {};
    for (const d of defs) cleared[d.id] = 0;
    setSubItems(cleared);
    setQty(1);
  };

  // Computed summary of sub-items
  const { summary: countedSummary, totalPieces } = useMemo(() => {
    if (!selected || selected === "money") return { summary: [], totalPieces: 0 };
    return computeSubItemsQty(selected as Exclude<DonationCategory, "money">, subItems);
  }, [selected, subItems]);
  const otherSummary = others.filter((o) => o.name.trim())
    .map((o) => `Other: ${o.name.trim()}${o.amount.trim() ? ` (${o.amount.trim()})` : ""}`);
  // in "Direct Number" mode the listed items are not used, only what the donor typed in
  const subItemSummary = selected === "money" ? [] : [...(calcMode === "itemized" ? countedSummary : []), ...otherSummary];

  const item = selected && selected !== "money" ? (selected as ItemKey) : null;
  const perPack = item === "books" ? packSize : 1;
  const packs = Math.floor(qty / perPack);
  const useModel = mode === "normal" && !!item && packs > 0;
  const [plan, setPlan] = useState<{ key: string; scope: string; data: ModelPlan } | null>(null);
  const [planFailed, setPlanFailed] = useState<string | null>(null); // planKey the model could not answer
  const planScope = `${item}|${donorDistrict}`;
  const planKey = `${planScope}|${packs}`;

  useEffect(() => {
    if (!useModel || !item) return;
    const stop = new AbortController();
    const timer = setTimeout(() => {
      api.predictNormal(item, packs, donorDistrict, stop.signal)
        .then((data) => setPlan({ key: planKey, scope: planScope, data }))
        .catch(() => !stop.signal.aborted && setPlanFailed(planKey));
    }, 250);
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [useModel, item, packs, donorDistrict, planKey, planScope]);

  // While the model works on a new quantity, keep showing its last answer for the same item and district instead of
  // jumping to the built-in estimate and back: the two rank areas differently, so the best match would flip twice.
  const planLoading = useModel && plan?.key !== planKey && planFailed !== planKey;
  const modelPlan = useModel && plan && (plan.key === planKey || (planLoading && plan.scope === planScope)) ? plan.data : null;

  const [needs, setNeeds] = useState<ModelNeeds | null>(null);
  useEffect(() => {
    if (mode !== "normal") return;
    const stop = new AbortController();
    api.predictNeeds(donorDistrict, stop.signal).then(setNeeds).catch(() => {});
    return () => stop.abort();
  }, [mode, donorDistrict]);
  const districtNeeds = mode === "normal" && needs?.district === donorDistrict ? needs : null;

  const predictions = useMemo<Place[]>(() => {
    if (!item || !qty) return [];
    if (modelPlan) {
      return modelPlan.areas.slice(0, 4).map((a) => ({
        key: `${a.district}|${a.ds}`, ds: a.ds, district: a.district, km: a.distanceKm, level: a.v2Level ?? a.needLevel,
        needs: a.room * perPack, qty: a.suggested * perPack,
        reason: `${(a.needProbability * 100).toFixed(1)}% likely to need ${ITEMS[item].noun}`
          + (a.v2Score == null ? ". " : `, ${ITEMS[item].need} need score ${a.v2Score.toFixed(0)} of 100. `)
          + `${fmt(a.given)} of ${fmt(a.limit)} packs received this month`
          + (a.statusAfter === "Closed" ? "; your donation fills its limit" : ""),
      }));
    }
    if (planLoading) return []; // the model's first answer is on its way
    // Disaster Mode, or the model cannot be reached
    return suggestAllocation(item, qty, donorDistrict, mode, adjustments, confirmedAreas, 4).map((p) => ({
      key: String(p.row.area.id), ds: p.row.area.ds, district: p.row.area.district, km: p.km,
      level: p.row.affected?.priority ?? p.row.level, needs: p.row.remaining, qty: p.qty, reason: p.reason,
    }));
  }, [item, qty, perPack, modelPlan, planLoading, donorDistrict, mode, adjustments, confirmedAreas]);

  const topDest = predictions[0] ?? null;

  // drop-off points nearest to the donor first (their own district has distance 0)
  const nearPoints = useMemo(
    () => [...points].sort((a, b) => distanceKm(donorDistrict, a.district) - distanceKm(donorDistrict, b.district) || a.name.localeCompare(b.name)),
    [points, donorDistrict],
  );
  const dropoff = handover === "dropoff" ? nearPoints.find((p) => p.id === dropoffId) ?? nearPoints[0] ?? null : null;

  if (done) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="rounded-2xl border border-line bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle2 size={42} className="text-brand-600" />
          </div>
          <h1 className="text-2xl font-bold text-ink">Thank you, {name.split(" ")[0]}!</h1>
          <p className="mt-3 text-ink-soft">
            Donation <span className="font-semibold text-ink">{done}</span> has been received.
            {topDest && (
              <> Your <span className="font-semibold text-ink">{qty} {cat?.unit}</span> will go to{" "}
                <span className="font-semibold text-ink">{topDest.ds}</span>, {topDest.district}.
              </>
            )}
          </p>
          {subItemSummary.length > 0 && (
            <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/50 p-3 text-xs text-brand-800 text-left">
              <p className="font-semibold mb-1">Items Included:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {subItemSummary.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-sm text-ink-muted">
            {dropoff
              ? `Please bring your items to ${dropoff.name}, ${dropoff.address} and give this donation number at the desk.`
              : "A collector from your district will contact you to arrange pickup."}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/donor/donations" className="rounded-xl bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700">
              Track donation
            </Link>
            <Link href="/donor/history" className="rounded-xl border border-line px-5 py-2.5 font-medium text-ink hover:bg-gray-50">
              View history
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (step === 0) {
    return (
      <>
        <PageHeader
          title="Make a Donation"
          subtitle="Choose what you want to donate, select specific items, and we'll calculate the distribution quantity and best match area."
        />
        <StepDots step={0} />

        {/* 1. Category Selection Cards */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CATEGORIES.map((c) => {
            const active = selected === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => handleSelectCategory(c.key)}
                className={`group relative flex flex-col items-start gap-3 rounded-2xl border-2 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                  active ? `${c.border} ${c.bg} shadow-md` : "border-line bg-white hover:border-gray-300"
                }`}
              >
                {active && (
                  <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600">
                    <CheckCircle2 size={14} className="text-white" />
                  </span>
                )}
                <span className={`rounded-xl p-2.5 ${active ? c.bg : "bg-gray-100 group-hover:bg-gray-50"} ${c.color}`}>
                  {c.icon}
                </span>
                <div>
                  <p className="font-semibold text-ink">{c.label}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{c.description}</p>
                  {(() => {
                    const n = districtNeeds?.items.find((i) => i.item.toLowerCase() === c.key);
                    if (!n) return null;
                    return n.areas ? (
                      <p className="mt-2 text-xs font-medium text-brand-700">
                        Needed in {n.areas} {n.areas === 1 ? "area" : "areas"} of {districtNeeds?.district} - {fmt(n.packsNeeded)} packs
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-ink-muted">{districtNeeds?.district} has enough this month</p>
                    );
                  })()}
                </div>
              </button>
            );
          })}
        </div>

        {/* 2. Sub-Item Selection & Calculation */}
        {cat && selected !== "money" && (
          <div className="mt-8">
            <Card
              title={`Choose items & calculate ${cat.unit}`}
              action={
                <div className="flex items-center rounded-xl border border-line bg-gray-50 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setCalcMode("itemized");
                      const { totalQty } = computeSubItemsQty(selected as Exclude<DonationCategory, "money">, subItems);
                      setQty(totalQty);
                    }}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                      calcMode === "itemized"
                        ? "bg-white font-semibold text-brand-700 shadow-sm"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    <Calculator size={14} /> Calculate from Items
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalcMode("direct")}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                      calcMode === "direct"
                        ? "bg-white font-semibold text-brand-700 shadow-sm"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    Direct Number
                  </button>
                </div>
              }
            >
              <div className="p-6">
                {(() => {
                  const pack = PACKS[selected as Exclude<DonationCategory, "money">];
                  return (
                    <div className={`mb-6 rounded-xl border p-4 ${cat.border} ${cat.bg}`}>
                      <p className="flex items-center gap-2 font-semibold text-ink">
                        <Package size={18} className={cat.color} /> {pack.name} =
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {pack.contents.map((c) => (
                          <li key={c} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink">{c}</li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-ink-soft">{pack.note}</p>
                    </div>
                  );
                })()}

                {calcMode === "itemized" ? (
                  <>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          Select the specific items you want to donate
                        </p>
                        <p className="text-xs text-ink-muted">
                          {selected === "food" && "Choose rice (2kg/5kg), water bottles, dhal, or canned foods. We calculate total family packs."}
                          {selected === "clothes" && "Select clothing by age category (infants, children, youth, elders & blankets)."}
                          {selected === "books" && "Enter the school bags, school books, pen & pencil sets and copies you are giving."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSubItems}
                        className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-gray-50 hover:text-ink"
                      >
                        <RotateCcw size={12} /> Clear all
                      </button>
                    </div>

                    {/* Sub-item Grid */}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {(SUB_ITEMS[selected as Exclude<DonationCategory, "money">] || []).map((sub) => {
                        const count = subItems[sub.id] || 0;
                        const isSelected = count > 0;
                        return (
                          <div
                            key={sub.id}
                            className={`flex flex-col justify-between rounded-xl border p-4 transition-all ${
                              isSelected
                                ? "border-brand-300 bg-brand-50/20 shadow-sm"
                                : "border-line bg-white hover:border-gray-300"
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-gray-100">
                                    {sub.icon}
                                  </span>
                                  <span className="font-semibold text-sm text-ink">{sub.name}</span>
                                </div>
                                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                                  {sub.tag}
                                </span>
                              </div>
                              <p className="mt-2 text-xs text-ink-muted leading-relaxed">{sub.desc}</p>
                            </div>

                            <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between">
                              <span className="text-xs text-ink-muted">{packRate(selected as Exclude<DonationCategory, "money">, sub)}</span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSubItem(sub.id, count - sub.step)}
                                  disabled={count <= 0}
                                  className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-white"
                                  aria-label={`Decrease ${sub.name}`}
                                >
                                  <Minus size={14} />
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  value={count}
                                  onChange={(e) => handleUpdateSubItem(sub.id, Number(e.target.value))}
                                  className="h-8 w-14 rounded-lg border border-line bg-white text-center text-sm font-semibold text-ink focus:border-brand-500 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSubItem(sub.id, count + (sub.step || 1))}
                                  className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink hover:bg-gray-100"
                                  aria-label={`Increase ${sub.name}`}
                                >
                                  <Plus size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSubItem(sub.id, count + 10)}
                                  className="hidden sm:inline-flex rounded-lg border border-line px-1.5 py-1 text-[11px] font-medium text-ink-soft hover:bg-gray-50"
                                >
                                  +10
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Calculation Summary Bar */}
                    <div className="mt-6 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-brand-100/40 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span className={`grid h-12 w-12 place-items-center rounded-xl text-white shadow-sm transition-colors ${
                            totalPieces > 0 ? "bg-brand-600" : "bg-gray-400"
                          }`}>
                            <Calculator size={24} />
                          </span>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-brand-800">
                              Calculated Distribution Total
                            </p>
                            <p className="text-2xl font-bold text-ink">
                              {qty}{" "}
                              <span className="text-lg font-medium text-brand-700">
                                {cat.unit}
                              </span>
                              {totalPieces > 0 ? (
                                <span className="ml-3 text-xs font-normal text-ink-muted">
                                  {selected === "books" && `= ${Math.floor(qty / packSize)} student packs `}
                                  ({totalPieces} total items selected)
                                </span>
                              ) : (
                                <span className="ml-3 text-xs font-normal text-ink-muted">
                                  (0 items selected)
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {totalPieces > 0 ? (
                            <span className="text-xs text-brand-700 font-medium bg-white px-3 py-1.5 rounded-lg border border-brand-200 shadow-sm">
                              ✓ Ready for delivery allocation
                            </span>
                          ) : (
                            <span className="text-xs text-amber-800 font-medium bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 shadow-sm">
                              Please add items above using +
                            </span>
                          )}
                        </div>
                      </div>

                      {totalPieces > 0 ? (
                        <div className="mt-4 pt-3 border-t border-brand-200/70">
                          <p className="text-xs font-medium text-brand-900 mb-2">Selected Breakdown:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {subItemSummary.map((itemStr, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center rounded-md bg-white px-2.5 py-1 text-xs font-medium text-ink shadow-xs border border-brand-100"
                              >
                                {itemStr}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 pt-3 border-t border-brand-200/70">
                          <p className="text-xs text-ink-muted italic">
                            No items selected yet. Click the <b>+</b> button on any item above to set what you want to donate.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  /* Direct Pack Entry Mode */
                  <div className="max-w-md mx-auto py-4">
                    <Field label={`How many ${cat.unit} are you donating?`}>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setQty(Math.max(cat.minQty, qty - 5))}
                          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-line bg-white text-xl font-medium text-ink hover:bg-gray-50"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={cat.minQty}
                          value={qty}
                          onChange={(e) => setQty(Math.max(cat.minQty, Number(e.target.value)))}
                          className="h-11 flex-1 rounded-xl border border-gray-300 bg-white px-4 text-center text-lg font-semibold text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                        />
                        <button
                          type="button"
                          onClick={() => setQty(qty + 5)}
                          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-line bg-white text-xl font-medium text-ink hover:bg-gray-50"
                        >
                          +
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-ink-muted">Unit: {cat.unit}</p>
                    </Field>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {[10, 25, 50, 100, 200].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setQty(v)}
                          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                            qty === v
                              ? "border-brand-500 bg-brand-50 text-brand-700"
                              : "border-line text-ink-soft hover:border-brand-300 hover:text-ink"
                          }`}
                        >
                          {v} {cat.unit}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anything else the donor gives */}
                <div className="mt-6 border-t border-line pt-5">
                  <p className="text-sm font-semibold text-ink">Giving something else?</p>
                  <p className="text-xs text-ink-muted">
                    Add anything else you are giving that is not listed. It is passed to the collector and is not counted
                    in the {cat.unit} above.
                  </p>
                  <div className="mt-3 space-y-2">
                    {others.map((o, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label={`Other item ${i + 1}`}
                          placeholder={selected === "food" ? "e.g. Sugar 1 kg" : selected === "clothes" ? "e.g. School shoes" : "e.g. Geometry box"}
                          value={o.name}
                          maxLength={80}
                          onChange={(e) => setOthers((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                          className="w-full sm:w-72"
                        />
                        <Input
                          aria-label={`Amount of other item ${i + 1}`}
                          placeholder="How many, e.g. 10 packets"
                          value={o.amount}
                          maxLength={40}
                          onChange={(e) => setOthers((l) => l.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                          className="w-56"
                        />
                        <button
                          type="button"
                          onClick={() => setOthers((l) => l.filter((_, j) => j !== i))}
                          className="grid h-10 w-10 place-items-center rounded-lg border border-line text-ink-muted hover:bg-gray-50 hover:text-danger-700"
                          aria-label={`Remove other item ${i + 1}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOthers((l) => [...l, { name: "", amount: "" }])}
                    disabled={others.length >= 10}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40"
                  >
                    <Plus size={14} /> Add another item
                  </button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Money Category Handler */}
        {cat && selected === "money" && (
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Card title="Set donation amount">
              <div className="p-5">
                <Field label="How much would you like to donate?">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setQty(Math.max(cat.minQty, qty - 500))}
                      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-line bg-white text-xl font-medium text-ink hover:bg-gray-50"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={cat.minQty}
                      value={qty}
                      onChange={(e) => setQty(Math.max(cat.minQty, Number(e.target.value)))}
                      className="h-11 flex-1 rounded-xl border border-gray-300 bg-white px-4 text-center text-lg font-semibold text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    />
                    <button
                      type="button"
                      onClick={() => setQty(qty + 500)}
                      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-line bg-white text-xl font-medium text-ink hover:bg-gray-50"
                    >
                      +
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-ink-muted">Currency: Sri Lankan Rupee (LKR)</p>
                </Field>

                <div className="mt-4 flex flex-wrap gap-2">
                  {[1000, 5000, 10000, 25000, 50000].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setQty(v)}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                        qty === v
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-line text-ink-soft hover:border-brand-300 hover:text-ink"
                      }`}
                    >
                      LKR {v.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            <Card title="Estimated impact">
              <div className="p-5 space-y-3">
                <p className="text-sm text-ink-soft">Your funds are distributed across the highest-need relief sectors:</p>
                {[
                  { label: "Food packs & dry rations", pct: 50, color: "bg-orange-400" },
                  { label: "Clothing sets for displaced families", pct: 30, color: "bg-sky-400" },
                  { label: "School bags & educational supplies", pct: 20, color: "bg-violet-400" },
                ].map((row) => (
                  <div key={row.label}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-ink">{row.label}</span>
                      <span className="font-semibold text-ink">
                        LKR {Math.round((qty * row.pct) / 100).toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full ${row.color} rounded-full`} style={{ width: `${row.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Location selector */}
        {cat && (
          <Card className="mt-6" title="Your location">
            <div className="p-5">
              <Field label="Which district are you donating from?">
                <Select value={donorDistrict} onChange={(e) => setDonorDistrict(e.target.value)} className="w-full">
                  {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
                </Select>
              </Field>
              <p className="mt-2 text-xs text-ink-muted">We use this to find the closest area that needs your donation most.</p>
            </div>
          </Card>
        )}

        {/* Prediction Results */}
        {cat && selected !== "money" && qty > 0 && predictions.length > 0 && (
          <div className="mt-6 rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5">
            <div className="mb-4 flex items-center gap-2 text-brand-700">
              <Sparkles size={20} />
              <p className="font-semibold">Predicted needed places for your donation</p>
            </div>
            {modelPlan && (
              <p className="-mt-2 mb-4 text-sm text-ink-soft">
                From the need models, nearest to {donorDistrict} first, then highest need (records up to {modelPlan.asOf}).{" "}
                {planLoading
                  ? "Updating for the new quantity..."
                  : modelPlan.unplaced > 0
                  ? `${fmt(modelPlan.unplaced * perPack)} ${cat.unit} could not be placed: every area that needs them is at its monthly limit.`
                  : `Your ${fmt(modelPlan.placed * perPack)} ${cat.unit} fit in ${modelPlan.areaCount} ${modelPlan.areaCount === 1 ? "area" : "areas"}.`}
              </p>
            )}
            <div className={`grid gap-3 transition-opacity sm:grid-cols-2 xl:grid-cols-4 ${planLoading ? "opacity-60" : ""}`} aria-busy={planLoading}>
              {predictions.map((p, i) => (
                <div
                  key={p.key}
                  className={`relative rounded-xl border p-4 transition-all ${
                    i === 0 ? "border-brand-300 bg-white shadow-sm" : "border-line bg-white"
                  }`}
                >
                  {i === 0 && (
                    <span className="absolute -top-2 left-3 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
                      Best match
                    </span>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink">{p.ds}</p>
                      <p className="text-xs text-ink-muted">{p.district}</p>
                    </div>
                    <LevelBadge level={p.level} />
                  </div>
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="flex items-center gap-1.5 text-ink-soft">
                      <MapPin size={13} />
                      <span>{p.km} km away</span>
                    </div>
                    <p className="text-ink-soft">
                      Needs <span className="font-semibold text-ink">{fmt(p.needs)}</span>{" "}
                      {ITEMS[selected as ItemKey].unit}
                    </p>
                    <p className="text-xs text-ink-muted">{p.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {cat && selected !== "money" && qty > 0 && planLoading && predictions.length === 0 && (
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50/60 p-5 text-sm text-brand-700" role="status">
            <Sparkles size={20} className="animate-pulse" />
            Finding the areas that need your donation...
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            disabled={!selected || qty < 1 || planLoading || (calcMode === "itemized" && totalPieces === 0 && others.length === 0)}
            onClick={() => setStep(1)}
            className="px-8 py-3 text-base"
          >
            Continue to details <ChevronRight size={18} />
          </Button>
        </div>
      </>
    );
  }

  if (step === 1) {
    return (
      <>
        <PageHeader title="Your Details" subtitle="Tell us who you are and how your donation will reach us." />
        <StepDots step={1} />
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Summary Banner */}
          <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-brand-900">{cat?.label} Donation</p>
                <p className="text-sm text-brand-700">
                  Total Quantity: <b>{qty} {cat?.unit}</b>
                </p>
              </div>
              {subItemSummary.length > 0 && (
                <span className="rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-800 shadow-xs">
                  {subItemSummary.length} items specified
                </span>
              )}
            </div>
          </div>

          <Card title="Contact information">
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Full name / organisation">
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Phone number">
                <Input required value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="District">
                <Select value={donorDistrict} onChange={(e) => setDonorDistrict(e.target.value)}>
                  {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <Card title="How will you hand over your donation?">
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2" role="radiogroup" aria-label="Handover method">
                {([
                  { key: "pickup", icon: <Truck size={20} />, title: "Collector picks up", text: "A collector from your district comes to your address." },
                  { key: "dropoff", icon: <Warehouse size={20} />, title: "I will drop it off",
                    text: points.length ? "Bring your items to a drop-off point yourself. No waiting for a collector." : "No drop-off points are open yet." },
                ] as const).map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={handover === o.key}
                    disabled={o.key === "dropoff" && !points.length}
                    onClick={() => setHandover(o.key)}
                    className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      handover === o.key ? "border-brand-500 bg-brand-50" : "border-line bg-white hover:border-gray-300"
                    }`}
                  >
                    <span className={handover === o.key ? "text-brand-700" : "text-ink-muted"}>{o.icon}</span>
                    <span>
                      <span className="block font-semibold text-ink">{o.title}</span>
                      <span className="block text-sm text-ink-muted">{o.text}</span>
                    </span>
                  </button>
                ))}
              </div>

              {handover === "pickup" ? (
                <div className="sm:col-span-2">
                  <Field label="Pickup address">
                    <Input required value={address} onChange={(e) => setAddress(e.target.value)} />
                  </Field>
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <Field
                    label="Drop-off point"
                    hint={nearPoints[0] && nearPoints[0].district !== donorDistrict
                      ? `There is no drop-off point in ${donorDistrict} yet. The nearest ones are listed first.` : undefined}
                  >
                    <Select value={dropoff?.id ?? ""} onChange={(e) => setDropoffId(e.target.value)}>
                      {nearPoints.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} - {p.district}{p.district === donorDistrict ? "" : ` (${distanceKm(donorDistrict, p.district)} km)`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {dropoff && (
                    <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm">
                      <p className="flex items-center gap-1.5 font-semibold text-ink"><MapPin size={14} />{dropoff.address}</p>
                      <p className="mt-1 text-ink-soft">
                        {[dropoff.hours && `Open ${dropoff.hours}`, dropoff.phone && `Phone ${dropoff.phone}`].filter(Boolean).join(" - ")
                          || "Ask at the counter for the ReliefHub collection desk."}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <Field label={handover === "pickup" ? "Preferred date" : "Day you will bring it"}>
                <Input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
              </Field>
              <Field label="Time window">
                <Select value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)}>
                  <option>Morning (8am - 12pm)</option>
                  <option>Afternoon (12pm - 4pm)</option>
                  <option>Evening (4pm - 7pm)</option>
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field label={handover === "pickup" ? "Notes for the collector (optional)" : "Notes for the drop-off point (optional)"}>
                  <Textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. items are boxed and ready, call 10 mins before arrival"
                  />
                </Field>
              </div>
            </div>
          </Card>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(0)} className="flex-1 py-3">Back</Button>
            <Button
              disabled={!name || !phone || !email || (handover === "pickup" ? !address : !dropoff)}
              onClick={() => setStep(2)}
              className="flex-1 py-3 text-base"
            >
              Review and confirm <ChevronRight size={18} />
            </Button>
          </div>
        </div>
      </>
    );
  }

  const handleSubmit = async () => {
    if (!selected || saving) return;
    if (selected === "money" || !topDest) return setDone(`DN-${1043 + Math.floor(Math.random() * 900)}`);
    setSaving(true);
    setError("");

    // Build comprehensive notes with item breakdown if items were selected
    const breakdownText = subItemSummary.length > 0 ? `Items Included: ${subItemSummary.join(", ")}` : "";
    const combinedNotes = notes ? (breakdownText ? `${notes} (${breakdownText})` : notes) : breakdownText;

    try {
      const saved = await addDonation({
        donor: name,
        phone,
        email,
        address: dropoff ? "" : address,
        dropoffId: dropoff?.id,
        district: donorDistrict,
        items: [{ item: selected as ItemKey, qty }],
        targetDs: topDest.ds,
        targetDistrict: topDest.district,
        date: pickupDate || new Date().toISOString().slice(0, 10),
        notes: combinedNotes,
      });
      setDone(saved.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Confirm Donation" subtitle="Review your donation details before submitting." />
      <StepDots step={2} />
      <div className="mx-auto max-w-2xl space-y-6">
        <Card title="Donation summary">
          <div className="divide-y divide-line">
            {[
              { label: "Category", value: cat?.label },
              { label: "Total Quantity", value: `${qty.toLocaleString()} ${cat?.unit}` },
              ...(subItemSummary.length > 0
                ? [{ label: "Item Breakdown", value: subItemSummary.join(" · ") }]
                : []),
              ...(selected === "books"
                ? [{ label: "Student packs", value: `${Math.floor(qty / packSize)} (${PACKS.books.contents.join(", ")} each)` }]
                : []),
              { label: "Donor", value: name },
              { label: "Phone", value: phone },
              dropoff
                ? { label: "Drop-off point", value: `${dropoff.name}, ${dropoff.address} (${dropoff.district})` }
                : { label: "Pickup address", value: address },
              { label: "District", value: donorDistrict },
              { label: dropoff ? "Drop-off date" : "Pickup date", value: pickupDate || "Flexible" },
              { label: "Time window", value: timeWindow },
              ...(notes ? [{ label: "Donor Notes", value: notes }] : []),
            ].map((row) => (
              <div key={row.label} className="flex gap-4 px-5 py-3 text-sm">
                <span className="w-36 flex-shrink-0 text-ink-muted">{row.label}</span>
                <span className="font-medium text-ink">{row.value}</span>
              </div>
            ))}
          </div>
        </Card>

        {selected !== "money" && predictions.length > 0 && (
          <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5">
            <div className="mb-3 flex items-center gap-2 text-brand-700">
              <Sparkles size={20} />
              <p className="font-semibold">Where your donation will go</p>
            </div>
            <div className="space-y-3">
              {predictions.slice(0, 2).map((p, i) => (
                <div key={p.key} className="rounded-xl border border-brand-100 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        {i === 0 && (
                          <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">Primary</span>
                        )}
                        {i === 1 && (
                          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-ink-soft">Overflow</span>
                        )}
                        <p className="font-semibold text-ink">{p.ds}, {p.district}</p>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-muted">{p.reason}</p>
                    </div>
                    <div className="text-right">
                      <LevelBadge level={p.level} />
                      <p className="mt-1 text-xs text-ink-muted">{p.km} km</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">
                    Allocating{" "}
                    <span className="font-semibold text-ink">
                      {fmt(p.qty)} {ITEMS[selected as ItemKey].unit}
                    </span>{" "}
                    - {fmt(p.needs)} still needed
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}

        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setStep(1)} className="flex-1 py-3">Back</Button>
          <Button onClick={handleSubmit} disabled={saving} className="flex-1 py-3 text-base">
            <Heart size={18} /> {saving ? "Saving..." : "Donate now"}
          </Button>
        </div>
      </div>
    </>
  );
}
