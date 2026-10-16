import { requireOwner } from '@/lib/auth/owner';
import { loadQrListing } from '@/lib/qr/listing';
import { QrStudio } from '@/components/qr-studio';

export const dynamic = 'force-dynamic';

export default async function QrCodesPage() {
  const owner = await requireOwner();
  const { links, codes } = await loadQrListing(owner.id);

  return (
    <div className="page-wrap">
      <header className="page-head">
        <h1 className="page-title">QR Codes</h1>
        <p className="page-lede">
          Create a managed code you can restyle after printing. A code pointed at one of your
          links keeps working when you change where that link goes — which is the whole reason to
          use a managed code rather than a generated image.
        </p>
      </header>

      <QrStudio links={links} codes={codes} />
    </div>
  );
}