import ContactForm from "@/components/contact-form";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12">
      <main className="w-full max-w-xl rounded-2xl bg-white p-8 shadow">
        <h1 className="text-3xl font-bold">Contact</h1>
        <ContactForm />
      </main>
    </div>
  );
}
