import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step2ApplicationCompletion } from '../Step2ApplicationCompletion';
import { apiService } from '../../services/api';

const uploaded = (name: string) => ({ filename: `srv_${name}`, url: `/api/uploads/srv_${name}`, originalName: name, mimeType: 'application/pdf', size: 1234 });
const file = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

async function fillSponsor(user: ReturnType<typeof userEvent.setup>, name = 'Anan Sukhumvit', id = 'AB9876543') {
  await user.click(screen.getByRole('button', { name: /Add Sponsor/i }));
  await user.type(screen.getByPlaceholderText(/Full name as shown on legal ID\/Passport/i), name);
  await user.type(screen.getByPlaceholderText(/Israeli ID or Foreign Passport/i), id);
}

describe('Step 2: sponsor ID or passport copy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('needs the document before a sponsor can be saved', async () => {
    const user = userEvent.setup();
    render(<Step2ApplicationCompletion language="en" onSubmit={vi.fn()} />);
    await fillSponsor(user);

    await user.click(screen.getByRole('button', { name: 'Save Sponsor' }));
    expect(screen.getByText("Please upload a copy of the sponsor's ID or passport.")).toBeInTheDocument();
    expect(screen.queryByText(/1\. Anan Sukhumvit/)).toBeNull();
  });

  it('uploads the document, saves it with the sponsor and submits it with Step 2', async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(apiService, 'uploadFile').mockResolvedValue(uploaded('anan-passport.pdf'));
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Step2ApplicationCompletion language="en" onSubmit={onSubmit} />);
    await fillSponsor(user);

    await user.upload(screen.getByTestId('sponsor-doc-input'), file('anan-passport.pdf'));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('anan-passport.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Sponsor' }));

    expect(screen.getByText(/1\. Anan Sukhumvit/)).toBeInTheDocument();
    expect(screen.getByText('anan-passport.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Submit Loan Application/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sponsor = onSubmit.mock.calls[0][0].sponsors[0];
    expect(sponsor).toMatchObject({ fullName: 'Anan Sukhumvit', idOrPassportNumber: 'AB9876543' });
    expect(sponsor.document).toMatchObject({ filename: 'srv_anan-passport.pdf', fileUrl: '/api/uploads/srv_anan-passport.pdf', originalName: 'anan-passport.pdf' });
  });

  it('shows an upload error from the server and keeps the sponsor unsaved', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiService, 'uploadFile').mockRejectedValue(new Error('File content does not match genuine PDF or image format. Disguised or corrupted files are rejected for security.'));
    render(<Step2ApplicationCompletion language="en" onSubmit={vi.fn()} />);
    await fillSponsor(user);

    await user.upload(screen.getByTestId('sponsor-doc-input'), file('fake.pdf'));
    expect(await screen.findByText(/rejected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Sponsor' })).toBeEnabled();
    expect(screen.queryByText('fake.pdf')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save Sponsor' }));
    expect(screen.queryByText(/1\. Anan Sukhumvit/)).toBeNull();
  });

  it('a saved sponsor without a document blocks the submission until it is uploaded from the list', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiService, 'uploadFile').mockResolvedValue(uploaded('late-id.pdf'));
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Step2ApplicationCompletion
        language="en"
        onSubmit={onSubmit}
        initialData={{ loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 }, sponsors: [{ id: 's1', fullName: 'Old Sponsor', idOrPassportNumber: 'AA543210' }] }}
      />
    );

    expect(screen.getByText('No ID or passport copy yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Submit Loan Application/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Each sponsor needs a copy of their ID or passport. Please upload the missing documents.')).toBeInTheDocument();

    await user.upload(screen.getByLabelText('Upload document'), file('late-id.pdf'));
    expect(await screen.findByText('late-id.pdf')).toBeInTheDocument();
    expect(screen.queryByText('No ID or passport copy yet')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Submit Loan Application/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].sponsors[0].document.filename).toBe('srv_late-id.pdf');
  });

  it('read-only: shows the document name and offers no upload', () => {
    render(
      <Step2ApplicationCompletion
        language="en"
        isReadOnly
        initialData={{
          loan: { requestedAmountNis: 5000, repaymentPeriodMonths: 6 },
          sponsors: [{ id: 's1', fullName: 'Anan Sukhumvit', idOrPassportNumber: 'AB9876543', document: { ...uploaded('anan.pdf'), fileUrl: '/api/uploads/srv_anan.pdf' } }],
        }}
      />
    );
    expect(screen.getByText('anan.pdf')).toBeInTheDocument();
    expect(screen.queryByLabelText('Upload document')).toBeNull();
  });

  it('is shown in Hebrew', async () => {
    const user = userEvent.setup();
    render(<Step2ApplicationCompletion language="he" onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /הוספת ערב|ערב/ }));
    expect(screen.getByText('צילום תעודת הזהות או הדרכון של הערב')).toBeInTheDocument();
    expect(screen.getByText('העלאת מסמך')).toBeInTheDocument();
  });
});
