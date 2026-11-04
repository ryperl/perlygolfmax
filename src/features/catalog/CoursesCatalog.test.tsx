import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventChangedError } from '../../client/events';
import { fakeCatalog, fictionalEntry, fictionalImport, fictionalSource, fictionalVersion } from '../../client/catalog.test-support';
import { CoursesCatalog } from './CoursesCatalog';
import type { CourseCatalogPage, CourseImportSession, CourseVersion } from '../../domain/catalog';

function sourceFile(value: unknown = fictionalSource()) {
  const file = new File([JSON.stringify(value)], 'fictional-course.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(value)), configurable: true });
  return file;
}

describe('manager course catalog', () => {
  it('waits for the initial list before allowing a refresh or staged write, and then retains the newer refreshed revision', async () => {
    const client = fakeCatalog();
    let finish: ((page: CourseCatalogPage) => void) | undefined;
    const initial = new Promise<CourseCatalogPage>((resolve) => { finish = resolve; });
    vi.mocked(client.courses).mockReturnValueOnce(initial)
      .mockResolvedValue({ courses: [{ ...fictionalEntry, etag: 'course-v2' }] });
    const user = userEvent.setup();
    render(<CoursesCatalog client={client} />);
    const refresh = screen.getByRole('button', { name: 'Refresh course catalog' });
    expect(refresh).toBeDisabled();
    await user.click(refresh);
    await user.upload(screen.getByLabelText('Course JSON file'), sourceFile());
    await screen.findByText(/independent tee profiles/);
    expect(screen.getByRole('button', { name: 'Stage import' })).toBeDisabled();
    expect(client.courses).toHaveBeenCalledTimes(1);
    expect(client.beginImport).not.toHaveBeenCalled();
    await act(async () => { finish?.({ courses: [fictionalEntry] }); await initial; });
    expect(refresh).toBeEnabled();
    await user.click(refresh);
    await screen.findByText(/current revision course-v2/);
    expect(client.courses).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Stage import' })).toBeEnabled();
  });

  it('enables catalog retry after a settled initial failure without enabling staged writes before a successful list', async () => {
    const client = fakeCatalog();
    let reject: ((error: Error) => void) | undefined;
    const initial = new Promise<CourseCatalogPage>((_resolve, fail) => { reject = fail; });
    vi.mocked(client.courses).mockReturnValueOnce(initial);
    const user = userEvent.setup();
    render(<CoursesCatalog client={client} />);
    await act(async () => { reject?.(new Error('Initial courses unavailable.')); await initial.catch(() => undefined); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Initial courses unavailable');
    expect(screen.getByRole('button', { name: 'Refresh course catalog' })).toBeEnabled();
    await user.upload(screen.getByLabelText('Course JSON file'), sourceFile());
    expect(screen.getByRole('button', { name: 'Stage import' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh course catalog' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Stage import' })).toBeEnabled(); });
  });

  it('reconciles an uncertain committed publication on refresh without reposting against the changed root revision', async () => {
    const client = fakeCatalog();
    let fail: ((reason: Error) => void) | undefined;
    const publish = new Promise<CourseVersion>((_resolve, reject) => { fail = reject; });
    vi.mocked(client.publish).mockReturnValueOnce(publish);
    const user = userEvent.setup();
    render(<CoursesCatalog client={client} />);
    await user.upload(screen.getByLabelText('Course JSON file'), sourceFile());
    await user.click(screen.getByRole('button', { name: 'Stage import' }));
    await user.click(await screen.findByRole('checkbox', { name: /I approve publishing/ }));
    await user.click(screen.getByRole('button', { name: 'Publish staged version' }));
    await waitFor(() => { expect(client.publish).toHaveBeenCalledTimes(1); });
    expect(client.publish).toHaveBeenCalledWith(fictionalImport.id, 'course-v1', expect.any(AbortSignal));
    vi.mocked(client.courses).mockResolvedValue({ courses: [{ ...fictionalEntry, etag: 'published-root-v2' }] });
    let statusFinish: ((value: CourseImportSession) => void) | undefined;
    const committed = new Promise<CourseImportSession>((resolve) => { statusFinish = resolve; });
    vi.mocked(client.importStatus).mockReturnValueOnce(committed);
    await act(async () => { fail?.(new Error('Publication response timed out.')); await publish.catch(() => undefined); });
    await screen.findByText('Publication response timed out.');
    await user.click(screen.getByRole('button', { name: 'Refresh course catalog' }));
    expect(screen.getByRole('button', { name: 'Publish staged version' })).toBeDisabled();
    await act(async () => {
      statusFinish?.({ ...fictionalImport, profilesReceived: [901, 905], publishedVersionId: fictionalVersion.id });
      await committed;
    });
    expect(await screen.findByText(/was already saved. Catalog refreshed; no publication was repeated/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Publish staged version' })).not.toBeInTheDocument();
    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(client.beginImport).toHaveBeenCalledTimes(1);
    expect(client.uploadProfile).toHaveBeenCalledTimes(2);
    for (const [id] of vi.mocked(client.importStatus).mock.calls) expect(id).toBe(fictionalImport.id);
  });

  it('checks a complete import status before retrying an uncertain publish, with no second POST for an already-saved version', async () => {
    const client = fakeCatalog();
    vi.mocked(client.publish).mockRejectedValueOnce(new Error('Uncertain publish.'));
    const user = userEvent.setup();
    render(<CoursesCatalog client={client} />);
    await user.upload(screen.getByLabelText('Course JSON file'), sourceFile());
    await user.click(screen.getByRole('button', { name: 'Stage import' }));
    await user.click(await screen.findByRole('checkbox', { name: /I approve publishing/ }));
    await user.click(screen.getByRole('button', { name: 'Publish staged version' }));
    await screen.findByText('Uncertain publish.');
    expect(screen.getByRole('button', { name: 'Refresh staged import status' })).toBeEnabled();
    vi.mocked(client.importStatus).mockResolvedValue({ ...fictionalImport, profilesReceived: [901, 905], publishedVersionId: fictionalVersion.id });
    await user.click(screen.getByRole('button', { name: 'Publish staged version' }));
    await screen.findByText(/was already saved. No publication was repeated/);
    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(client.importStatus).toHaveBeenLastCalledWith(fictionalImport.id, expect.any(AbortSignal));
  });
  it('previews published version provenance without treating import time as source freshness or choosing a tee', async () => {
    const client = fakeCatalog();
    const user = userEvent.setup();
    render(<CoursesCatalog client={client} />);
    await user.click(await screen.findByRole('button', { name: 'View Fictional Meadows version' }));
    expect(await screen.findByRole('region', { name: 'Published course version' })).toHaveTextContent('freshness unknown');
    expect(screen.getByText(/Import time does not establish source freshness/)).toBeVisible();
    expect(screen.getAllByText(/Fictional Teal/)).toHaveLength(2);
    expect(client.version).toHaveBeenCalledWith(fictionalVersion.courseId, fictionalVersion.id, expect.any(AbortSignal));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const preview = screen.getByText(/Fictional Teal \/ Fictional A/);
    await user.click(preview);
    const details = preview.closest('details');
    if (!details) throw new Error('Published profile preview is missing.');
    expect(within(details).getByRole('table', { name: 'Hole yardage, par and stroke index' })).toBeVisible();
    expect(within(details).getByRole('table', { name: 'Course and slope ratings' })).toBeVisible();
  });
  it('rejects oversized or malformed JSON before sending any import and does not render raw parse snippets', async () => {
    const client = fakeCatalog();
    const user = userEvent.setup();
    render(<CoursesCatalog client={client} />);
    const read = vi.fn().mockResolvedValue('not read');
    const large = new File([' '.repeat(1_000_001)], 'fictional-large.json', { type: 'application/json' });
    Object.defineProperty(large, 'text', { value: read });
    await user.upload(screen.getByLabelText('Course JSON file'), large);
    expect(await screen.findByText(/1 MB local import limit/)).toBeVisible();
    expect(read).not.toHaveBeenCalled();
    const malformed = new File(['fictional private fragment'], 'fictional-malformed.json', { type: 'application/json' });
    Object.defineProperty(malformed, 'text', { value: () => Promise.resolve('fictional private fragment') });
    await user.upload(screen.getByLabelText('Course JSON file'), malformed);
    await screen.findByText('Selected file is not valid JSON. Nothing was imported.');
    expect(screen.queryByText(/private fragment/)).not.toBeInTheDocument();
    expect(client.beginImport).not.toHaveBeenCalled();
  });
  it('stages all independent profiles, resumes a failed upload and only publishes after explicit revision approval', async () => {
    const client = fakeCatalog();
    vi.mocked(client.uploadProfile)
      .mockResolvedValueOnce({ ...fictionalImport, profilesReceived: [901] })
      .mockRejectedValueOnce(new Error('Profile upload failed; staged only.'))
      .mockResolvedValueOnce({ ...fictionalImport, profilesReceived: [901, 905] });
    vi.mocked(client.importStatus).mockResolvedValueOnce({ ...fictionalImport, profilesReceived: [901] })
      .mockResolvedValue({ ...fictionalImport, profilesReceived: [901, 905] });
    const user = userEvent.setup();
    render(<CoursesCatalog client={client} />);
    await screen.findByText('Fictional City');
    await user.upload(screen.getByLabelText('Course JSON file'), sourceFile());
    await screen.findByText(/2 independent tee profiles/);
    expect(screen.getAllByText(/Fictional Teal/)).toHaveLength(2);
    const preview = screen.getByText(/Fictional Teal \/ Fictional B/);
    await user.click(preview);
    const details = preview.closest('details');
    if (!details) throw new Error('Staged profile preview is missing.');
    expect(within(details).getByRole('table', { name: 'Hole yardage, par and stroke index' })).toBeVisible();
    expect(screen.getByText(/freshness unknown/)).toBeVisible();
    expect(client.beginImport).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stage import' }));
    await screen.findByText(/Profile upload failed/);
    expect(client.publish).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Publish staged version' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume staged import' }));
    const publish = await screen.findByRole('button', { name: 'Publish staged version' });
    expect(publish).toBeDisabled();
    expect(client.beginImport).toHaveBeenCalledTimes(1);
    expect(client.uploadProfile).toHaveBeenCalledTimes(3);
    expect(vi.mocked(client.uploadProfile).mock.calls[2]?.[1].id).toBe(905);
    await user.click(screen.getByRole('checkbox', { name: /I approve publishing/ }));
    await user.click(publish);
    await screen.findByText(/Course version .* saved/);
    expect(client.publish).toHaveBeenCalledWith(fictionalImport.id, fictionalEntry.etag, expect.any(AbortSignal));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('keeps manifest retry identity and requires refresh plus renewed approval after publication conflict', async () => {
    const client = fakeCatalog();
    vi.mocked(client.beginImport).mockRejectedValueOnce(new Error('Manifest response lost.'));
    vi.mocked(client.publish).mockRejectedValueOnce(new EventChangedError('Data changed. Refresh before approving.'));
    const user = userEvent.setup();
    render(<CoursesCatalog client={client} />);
    await user.upload(screen.getByLabelText('Course JSON file'), sourceFile());
    await user.click(screen.getByRole('button', { name: 'Stage import' }));
    await screen.findByText('Manifest response lost.');
    await user.click(screen.getByRole('button', { name: 'Stage import' }));
    await screen.findByRole('button', { name: 'Publish staged version' });
    const calls = vi.mocked(client.beginImport).mock.calls;
    expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
    await user.click(screen.getByRole('checkbox', { name: /I approve publishing/ }));
    await user.click(screen.getByRole('button', { name: 'Publish staged version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh before approving');
    expect(screen.getByRole('button', { name: 'Publish staged version' })).toBeDisabled();
    vi.mocked(client.courses).mockResolvedValue({ courses: [{ ...fictionalEntry, etag: 'course-v2' }] });
    await user.click(screen.getByRole('button', { name: 'Refresh course catalog' }));
    const approval = await screen.findByRole('checkbox', { name: /current revision course-v2/ });
    expect(approval).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Publish staged version' })).toBeDisabled();
    await user.click(approval);
    await user.click(screen.getByRole('button', { name: 'Publish staged version' }));
    await waitFor(() => { expect(client.publish).toHaveBeenLastCalledWith(fictionalImport.id, 'course-v2', expect.any(AbortSignal)); });
  });

  it('rejects invalid files locally and suppresses late file reads after the draft is cleared', async () => {
    const client = fakeCatalog();
    const user = userEvent.setup();
    render(<CoursesCatalog client={client} />);
    await user.upload(screen.getByLabelText('Course JSON file'), sourceFile({ CourseId: 1 }));
    await screen.findByText(/missing or unsupported fields/);
    expect(screen.getByRole('button', { name: 'Stage import' })).toBeDisabled();
    expect(client.beginImport).not.toHaveBeenCalled();
    let finish: ((value: string) => void) | undefined;
    const read = new Promise<string>((resolve) => { finish = resolve; });
    const file = sourceFile();
    Object.defineProperty(file, 'text', { value: () => read, configurable: true });
    await user.upload(screen.getByLabelText('Course JSON file'), file);
    await user.click(screen.getByRole('button', { name: 'Start a different import' }));
    await act(async () => { finish?.(JSON.stringify(fictionalSource())); await read; });
    expect(screen.queryByText(/independent tee profiles/)).not.toBeInTheDocument();
  });

  it('locks writes while a request is pending and aborts staged work on unmount', async () => {
    const client = fakeCatalog();
    let finish: ((value: typeof fictionalImport) => void) | undefined;
    const response = new Promise<typeof fictionalImport>((resolve) => { finish = resolve; });
    vi.mocked(client.beginImport).mockReturnValue(response);
    const user = userEvent.setup();
    const { unmount } = render(<CoursesCatalog client={client} />);
    await user.upload(screen.getByLabelText('Course JSON file'), sourceFile());
    const stage = screen.getByRole('button', { name: 'Stage import' });
    await user.dblClick(stage);
    expect(client.beginImport).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Source label')).toBeDisabled();
    const requestSignal = vi.mocked(client.beginImport).mock.calls[0]?.[2];
    unmount();
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => { finish?.(fictionalImport); await response; });
    expect(client.uploadProfile).not.toHaveBeenCalled();
    expect(client.publish).not.toHaveBeenCalled();
    expect(fictionalVersion.provenance.exportedAt).toBeNull();
  });
});
