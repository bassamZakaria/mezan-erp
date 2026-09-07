import { useEffect, useMemo, useState, type FormEvent } from "react";
import { matchesSearch } from "@mezan/domain";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  IconButton,
  StatusPill,
  type DocumentListColumn,
} from "@mezan/ui";
import type { ItemSpecificationDTO, ItemSpecificationTypeDTO } from "@mezan/contracts";
import { FormColumns, FormError, FormPage, SectionCard, SelectField, TextField, ToggleField } from "../settings/form-controls";
import { useSubPage } from "../navigation";
import {
  useCreateItemSpecification,
  useDeleteItemSpecification,
  useItemSpecifications,
  useUpdateItemSpecification,
} from "../data/item-catalog-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/**
 * المواصفات — the reusable specification/attribute registry over the item
 * catalog. A tenant defines its own; nothing is seeded, so an empty registry
 * is a real, correct state.
 */

const TYPE_KEY: Record<ItemSpecificationTypeDTO, AppTranslationKey> = {
  select: "specs.type.select",
  number: "specs.type.number",
  text: "specs.type.text",
};

const TYPE_VALUES = Object.keys(TYPE_KEY) as ItemSpecificationTypeDTO[];
const PAGE_SIZES = [10, 25, 50, 100] as const;

interface Draft {
  code: string;
  nameAr: string;
  nameEn: string;
  type: ItemSpecificationTypeDTO;
  values: string;
  unit: string;
  filterable: boolean;
  active: boolean;
}

function blankDraft(): Draft {
  return { code: "", nameAr: "", nameEn: "", type: "select", values: "", unit: "", filterable: false, active: true };
}

function draftOf(specification: ItemSpecificationDTO): Draft {
  return {
    code: specification.code,
    nameAr: specification.nameAr,
    nameEn: specification.nameEn ?? "",
    type: specification.type,
    values: specification.values.join(", "),
    unit: specification.unit ?? "",
    filterable: specification.filterable,
    active: specification.status === "active",
  };
}

function parseValues(raw: string): string[] {
  return raw
    .split(/[،,\n]/)
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

/** Returns a catalogue KEY, so the caller decides the locale. */
function validate(draft: Draft): AppTranslationKey | null {
  if (!/^[A-Z0-9_-]{1,20}$/.test(draft.code.trim())) {
    return "specs.codeRequired";
  }
  if (draft.nameAr.trim() === "") return "specs.nameRequired";
  if (draft.type === "select" && parseValues(draft.values).length === 0) {
    return "specs.needsOneValue";
  }
  return null;
}

function valuesCell(specification: ItemSpecificationDTO, noUnitLabel: string) {
  if (specification.type === "select") {
    if (specification.values.length === 0) return <span className="text-ink-faint">—</span>;
    return (
      <div className="flex flex-wrap gap-[6px]">
        {specification.values.map((value) => (
          <span
            key={value}
            className="rounded-pill border border-border bg-surface-2 px-[9px] py-[2px] text-[11.5px] text-ink-muted"
          >
            {value}
          </span>
        ))}
      </div>
    );
  }
  if (specification.type === "number") {
    return specification.unit ? <span>{specification.unit}</span> : <span className="text-ink-faint">{noUnitLabel}</span>;
  }
  return <span className="text-ink-faint">—</span>;
}

/**
 * The create/edit form as its own PAGE, mounted per address.
 *
 * The draft is seeded from `specification` at MOUNT rather than pushed in by
 * an `openEdit` click, which is what lets `…/item-specifications/COLOR` be
 * reloaded, bookmarked and reached with Back. A panel opened by a click holds
 * only the state that click set, and a reload emptied it.
 */
function SpecificationFormPage({
  specification,
  onClose,
}: {
  specification: ItemSpecificationDTO | null;
  onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const createSpecification = useCreateItemSpecification();
  const updateSpecification = useUpdateItemSpecification();
  const [draft, setDraft] = useState<Draft>(specification ? draftOf(specification) : blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const editingCode = specification?.code ?? null;

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    const error = validate(draft);
    if (error) {
      setFormError(t(error));
      return;
    }
    setFormError(null);
    const values = draft.type === "select" ? parseValues(draft.values) : [];
    const unit = draft.type === "number" && draft.unit.trim() !== "" ? draft.unit.trim() : null;
    const nameEn = draft.nameEn.trim() === "" ? null : draft.nameEn.trim();
    try {
      if (editingCode) {
        await updateSpecification.mutateAsync({
          code: editingCode,
          patch: {
            nameAr: draft.nameAr.trim(),
            nameEn,
            values,
            unit,
            filterable: draft.filterable,
            status: draft.active ? "active" : "inactive",
          },
        });
      } else {
        await createSpecification.mutateAsync({
          code: draft.code.trim(),
          nameAr: draft.nameAr.trim(),
          nameEn,
          type: draft.type,
          values,
          unit,
          filterable: draft.filterable,
        });
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.failed"));
    }
  }

  return (
    <FormPage
      eyebrow={t("eyebrow.items.specifications")}
      title={editingCode ? t("specs.editSpecification") : t("specs.newSpecification")}
      description={t("specs.typeAndCodeAreFixed")}
      actions={
        <>
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="specification-form"
            variant="primary"
            disabled={createSpecification.isPending || updateSpecification.isPending}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="specification-form" onSubmit={submitForm} className="flex flex-col gap-4">
        <FormError message={formError} />

        <FormColumns
          aside={
            <SectionCard title={t("specs.section.behaviour")} columns={1}>
              <ToggleField
                label={t("specs.filterableInTheCatalogue")}
                checked={draft.filterable}
                onChange={(v) => setDraft((d) => ({ ...d, filterable: v }))}
              />
              <ToggleField
                label={t("specs.active")}
                checked={draft.active}
                onChange={(v) => setDraft((d) => ({ ...d, active: v }))}
              />
            </SectionCard>
          }
        >
        <SectionCard title={t("specs.section.definition")}>
          <TextField
            label={t("specs.code")}
            value={draft.code}
            onChange={(v) => setDraft((d) => ({ ...d, code: v.toUpperCase() }))}
            disabled={editingCode !== null}
            hint={t("specs.capitalLettersDigitsOr")}
          />
          <SelectField
            label={t("common.type")}
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as ItemSpecificationTypeDTO }))}
            options={TYPE_VALUES.map((value) => ({ value, label: t(TYPE_KEY[value]) }))}
            disabled={editingCode !== null}
          />
          <TextField
            label={t("specs.arabicName")}
            value={draft.nameAr}
            onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))}
          />
          <TextField
            label={t("specs.englishName")}
            value={draft.nameEn}
            onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))}
          />
          {draft.type === "select" ? (
            <TextField
              label={t("specs.allowedValues")}
              value={draft.values}
              onChange={(v) => setDraft((d) => ({ ...d, values: v }))}
              placeholder={t("specs.redGreenBlue")}
              hint={t("specs.separateValuesWithCommas")}
            />
          ) : null}
          {draft.type === "number" ? (
            <TextField
              label={t("common.unit")}
              value={draft.unit}
              onChange={(v) => setDraft((d) => ({ ...d, unit: v }))}
              placeholder={t("specs.kg")}
            />
          ) : null}
        </SectionCard>
        </FormColumns>
      </form>
    </FormPage>
  );
}

export function ItemSpecificationsScreen() {
  const { t } = useAppTranslation();
  const query = useItemSpecifications();
  const deleteSpecification = useDeleteItemSpecification();

  const specifications = query.data ?? EMPTY;

  const [searchText, setSearchText, search] = useUrlSearch();
  const [typeFilter, setTypeFilter] = useUrlParam("type", "all") as [
    ItemSpecificationTypeDTO | "all",
    (next: string) => void,
  ];
  const subPage = useSubPage();
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const filtered = useMemo(() => {
    let rows = specifications;
    if (typeFilter !== "all") rows = rows.filter((s) => s.type === typeFilter);
    const q = search.trim();
    if (q !== "") {
      rows = rows.filter((s) => matchesSearch(q, s.code, s.nameAr));
    }
    return rows;
  }, [specifications, typeFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  function openCreate() {
    subPage.open("new");
  }

  function openEdit(specification: ItemSpecificationDTO) {
    subPage.open(specification.code);
  }

  async function remove(specification: ItemSpecificationDTO) {
    if (deletingCode) return;
    setDeletingCode(specification.code);
    setRowError(null);
    try {
      await deleteSpecification.mutateAsync(specification.code);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : t("specs.theSpecificationCouldNotBe"));
    } finally {
      setDeletingCode(null);
    }
  }

  const columns: DocumentListColumn<ItemSpecificationDTO>[] = [
    {
      key: "nameAr",
      header: t("common.name"),
      render: (s) => (
        <div className="flex flex-col">
          <span className="flex items-center gap-[8px] font-semibold text-ink">
            {s.nameAr}
            {s.status === "active" ? null : <StatusPill label={t("specs.inactive")} tone="neutral" />}
          </span>
          <span className="font-mono text-[11.5px] text-ink-faint">{s.code}</span>
        </div>
      ),
    },
    { key: "type", header: t("common.type"), render: (s) => t(TYPE_KEY[s.type]) },
    { key: "values", header: t("specs.valuesUnit"), render: (specification) => valuesCell(specification, t("specs.noUnit")) },
    {
      key: "filterable",
      header: t("specs.filterableInTheCatalogue"),
      render: (s) => (
        <StatusPill label={s.filterable ? t("specs.yes") : t("specs.no")} tone={s.filterable ? "success" : "neutral"} />
      ),
    },
    {
      key: "usage",
      header: t("specs.usedBy"),
      align: "end",
      render: (s) => <span className="mz-num">{s.usageCount}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (s) => (
        <div className="flex items-center justify-end gap-[6px]">
          <Button size="sm" onClick={() => openEdit(s)}>
            {t("common.edit")}
          </Button>
          <IconButton
            aria-label={t("specs.deleteNamed", { name: s.nameAr })}
            disabled={deletingCode !== null || s.usageCount > 0}
            onClick={() => remove(s)}
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
              <path
                d="M4 6h12M8 6V4h4v2m-6 0 .7 9.1A1 1 0 0 0 7.7 16h4.6a1 1 0 0 0 1-.9L14 6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>
        </div>
      ),
    },
  ];

  /**
   * `new` creates; any other segment is a specification CODE to edit. The
   * record must be in hand before the form mounts — it seeds the draft — so a
   * code still loading renders the wait, and one that never resolves says so
   * rather than silently opening a blank create form.
   */
  const [segment] = subPage.segments;
  if (segment === "new") return <SpecificationFormPage specification={null} onClose={subPage.close} />;
  if (segment !== undefined) {
    const editing = specifications.find((row) => row.code === segment);
    if (editing) return <SpecificationFormPage specification={editing} onClose={subPage.close} />;
    if (query.isLoading) return <div className="w-full p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>;
    return (
      <div className="w-full p-8 text-center text-sm text-ink-muted">
        {t("specs.notFound")}
        <div className="mt-3">
          <Button variant="default" onClick={subPage.close}>
            {t("specs.backToList")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("specs.specificationsCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {rowError ? (
        <div
          role="alert"
          className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
        >
          {rowError}
        </div>
      ) : null}

      <DocumentList<ItemSpecificationDTO>
        title={t("specs.specifications")}
        description={t("specs.theRegisterOfReusableSpecifications")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("specs.newSpecification")}
          </Button>
        }
        listKey="item-specifications"
        statsCollapsible
        stats={[
          { label: t("specs.totalSpecifications"), value: <span className="mz-num">{specifications.length}</span> },
          {
            label: t("specs.filterable"),
            value: <span className="mz-num">{specifications.filter((s) => s.filterable).length}</span>,
          },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: specifications.length },
          { key: "select", label: t(TYPE_KEY.select), count: specifications.filter((s) => s.type === "select").length },
          { key: "number", label: t(TYPE_KEY.number), count: specifications.filter((s) => s.type === "number").length },
          { key: "text", label: t(TYPE_KEY.text), count: specifications.filter((s) => s.type === "text").length },
        ]}
        activeStatusKey={typeFilter}
        onStatusChange={(key) => {
          setTypeFilter(key as ItemSpecificationTypeDTO | "all");
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("specs.searchByCodeOrName")}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(s) => s.code}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")}{" "}
            <span className="mz-num">{filtered.length}</span> {t("specs.specifications2")}
          </>
        }
        emptyState={
          query.isLoading ? (
            <div className="p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>
          ) : (
            <EmptyState
              title={t("specs.noSpecificationsYetAddOne")}
              description={t("specs.emptyBody")}
              action={{ label: t("specs.newSpecification"), onClick: openCreate }}
            />
          )
        }
      />

    </div>
  );
}
