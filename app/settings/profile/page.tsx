"use client";

import { useEffect, useState } from "react";
import { UNIVERSITY, YEARS, type Year } from "../../data/universities/ntruhs/curriculum";
import { ageFromBirthday, useSettings } from "../../store/settings";
import PhotoCropper from "./PhotoCropper";

export default function ProfileSettingsPage() {
  const settings = useSettings();
  const [firstName, setFirstName] = useState(settings.firstName);
  const [lastName, setLastName] = useState(settings.lastName);
  const [birthday, setBirthday] = useState(settings.birthday);
  const [joiningYear, setJoiningYear] = useState(settings.joiningYear);
  const [year, setYear] = useState<Year>(settings.year);
  const [photo, setPhoto] = useState(settings.photo);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    setFirstName(settings.firstName);
    setLastName(settings.lastName);
    setBirthday(settings.birthday);
    setJoiningYear(settings.joiningYear);
    setYear(settings.year);
    setPhoto(settings.photo);
  }, [
    settings.firstName,
    settings.lastName,
    settings.birthday,
    settings.joiningYear,
    settings.year,
    settings.photo,
  ]);

  const age = ageFromBirthday(birthday);
  const dirty =
    firstName !== settings.firstName ||
    lastName !== settings.lastName ||
    birthday !== settings.birthday ||
    joiningYear !== settings.joiningYear ||
    year !== settings.year ||
    photo !== settings.photo;

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCropFile(file);
  }

  function save() {
    settings.saveProfile({ firstName, lastName, birthday, joiningYear, year, photo });
    setSavedAt(Date.now());
  }

  return (
    <div className="space-y-6 pb-24">
      <section>
        <h2 className="text-2xl font-bold tracking-tight">Profile</h2>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Photo</h3>
        <div className="mt-4 flex items-center gap-4">
          <div className="h-16 w-16 overflow-hidden rounded-full border border-slate-700 bg-slate-950">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                Photo
              </div>
            )}
          </div>
          <label className="cursor-pointer rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-teal-500/50">
            Choose photo
            <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-slate-200">First name</span>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-teal-500/50"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-200">Last name</span>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-teal-500/50"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-slate-200">Birthday</span>
            <input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-teal-500/50"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-200">Age</span>
            <input
              value={age}
              readOnly
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-400 outline-none"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-sm font-semibold text-slate-200">University</h3>
        <p className="mt-2 text-sm text-slate-300">{UNIVERSITY.name}</p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Academic year</h3>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {YEARS.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                year === y
                  ? "border-teal-500/60 bg-teal-500/10 text-teal-200"
                  : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-600"
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        <label className="mt-5 block sm:max-w-xs">
          <span className="text-sm font-semibold text-slate-200">Year of Admission</span>
          <input
            value={joiningYear}
            onChange={(e) => setJoiningYear(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder="e.g. 2023"
            className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-teal-500/50"
          />
        </label>
      </section>

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-slate-800 bg-slate-950/95 py-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty}
          className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          Save changes
        </button>
        {savedAt > 0 && !dirty ? <span className="text-sm text-teal-300">Saved</span> : null}
        {dirty ? <span className="text-sm text-slate-500">Unsaved</span> : null}
      </div>

      <PhotoCropper
        file={cropFile}
        onCancel={() => setCropFile(null)}
        onConfirm={(dataUrl) => {
          setPhoto(dataUrl);
          setCropFile(null);
        }}
      />
    </div>
  );
}
