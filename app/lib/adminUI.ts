// Shared styles for admin CRUD screens — modern, light, minimal.
import { StyleSheet } from 'react-native';
import { colors, radius, space, cardShadow } from './theme';

export const adminUI = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.muted, textAlign: 'center', marginTop: space.lg, fontSize: 13 },

  addBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: space.sm
  },
  addBtnText: { color: colors.primaryText, fontWeight: '600', letterSpacing: 0.3, fontSize: 14 },

  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    ...cardShadow
  },
  rowDisabled: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md
  },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '600', color: colors.text, letterSpacing: -0.1 },
  nameDim: { fontSize: 15, fontWeight: '600', color: colors.subtle, letterSpacing: -0.1 },
  metaSmall: { fontSize: 12, color: colors.muted, marginTop: 2 },
  price: { fontSize: 16, fontWeight: '700', color: colors.text },
  priceDim: { fontSize: 16, fontWeight: '700', color: colors.subtle },
  editLink: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.2 },

  // status pills
  pillOutline: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
    letterSpacing: 0.3
  },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dotOk: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok },
  dotWarn: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.warn },
  dotDanger: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger },
  statusOk: { fontSize: 11, fontWeight: '600', color: colors.ok, letterSpacing: 0.2 },
  statusWarn: { fontSize: 11, fontWeight: '600', color: colors.warn, letterSpacing: 0.2 },
  statusDanger: { fontSize: 11, fontWeight: '600', color: colors.danger, letterSpacing: 0.2 },

  // modal
  modalContainer: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  modalCancel: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  modalSave: { color: colors.text, fontSize: 14, fontWeight: '700' },
  modalBody: { padding: space.lg, gap: space.md },

  // form
  label: { fontSize: 11, color: colors.muted, fontWeight: '600', letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text
  },
  activeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },

  // ===== Modern list/modal building blocks (shared with Services look) =====
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  addBtnSm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.md
  },
  addBtnPressed: { opacity: 0.85 },

  rowInactive: { opacity: 0.55 },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rowMid: { flex: 1, gap: 3 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sub: { fontSize: 11, fontWeight: '600', color: colors.muted, letterSpacing: 0.2 },
  subDot: { fontSize: 11, color: colors.subtle },
  subOk: { color: colors.ok },
  subDanger: { color: colors.danger },

  empty: { alignItems: 'center', paddingVertical: space.xl, gap: space.sm },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: 'center', maxWidth: 260 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    marginTop: space.sm
  },

  // modal — modern
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: colors.primaryText, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  previewLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    letterSpacing: 1.2,
    marginBottom: -space.xs
  },
  formCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    marginTop: space.xs,
    ...cardShadow
  },
  priceField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface
  },
  pricePrefix: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: 11
  },
  priceInput: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text
  },
  priceSuffix: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
    paddingRight: space.md,
    paddingLeft: space.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingVertical: 11
  },
  helper: { fontSize: 11, color: colors.subtle, marginTop: 2 },
  activeRowDivided: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md
  }
});
