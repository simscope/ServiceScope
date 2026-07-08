import { ChangeEvent, FormEvent, useState } from 'react';
import { saveUserAccess, type AccessActionMode } from '../../services/accessInvite';
import { uploadCompanyLogo } from '../../services/companyAssets';
import {
  createCompanyJobType,
  createCompanyTechnician,
} from '../../services/companyOnboardingStore';
import { deleteJobTypeFromBackend } from '../../services/onboardingBackend';
import { emptyJobTypeForm, emptyTechnicianForm } from '../../appSeeds';
import type {
  Company,
  CompanyOnboardingProfile,
  NewCompanyJobTypeForm,
  NewCompanyTechnicianForm,
} from '../../types';

type SignedInCompanyUser = {
  name: string;
  email: string;
  role: 'Manager' | 'Admin' | 'Technician';
};

export function useOnboardingAdminFeature({
  activeCompany,
  profile,
  signedInUser,
  updateProfile,
  selectedJobTypeId,
  setSelectedJobTypeId,
}: {
  activeCompany?: Company;
  profile?: CompanyOnboardingProfile;
  signedInUser?: SignedInCompanyUser;
  updateProfile: (updates: Partial<CompanyOnboardingProfile>) => void;
  selectedJobTypeId: string;
  setSelectedJobTypeId: (jobTypeId: string) => void;
}) {
  const [technicianForm, setTechnicianForm] = useState<NewCompanyTechnicianForm>(emptyTechnicianForm);
  const [technicianAccessStatusById, setTechnicianAccessStatusById] = useState<Record<string, string>>({});
  const [technicianAccessPasswordById, setTechnicianAccessPasswordById] = useState<Record<string, string>>({});
  const [ownerAccessPassword, setOwnerAccessPassword] = useState('');
  const [ownerAccessPasswordConfirm, setOwnerAccessPasswordConfirm] = useState('');
  const [ownerAccessStatus, setOwnerAccessStatus] = useState('');
  const [jobTypeForm, setJobTypeForm] = useState<NewCompanyJobTypeForm>(emptyJobTypeForm);

  function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!activeCompany || !profile) return;
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      updateProfile({ logoUrl: String(reader.result) });
    };
    reader.readAsDataURL(file);

    uploadCompanyLogo(activeCompany.id, file)
      .then((logoUrl) => {
        updateProfile({ logoUrl });
      })
      .catch((error) => {
        console.error('Failed to upload company logo', error);
      });
  }

  function makeAccessPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
    const values = new Uint32Array(12);
    crypto.getRandomValues(values);

    return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
  }

  function generateOwnerPassword() {
    const password = makeAccessPassword();
    setOwnerAccessPassword(password);
    setOwnerAccessPasswordConfirm(password);
    setOwnerAccessStatus('Generated. Save it to apply the new owner password.');
  }

  async function saveOwnerPassword() {
    if (!activeCompany) return;
    const ownerEmail = signedInUser?.email || activeCompany.ownerEmail;
    const password = ownerAccessPassword.trim();

    if (!ownerEmail.trim()) {
      setOwnerAccessStatus('Owner email is required.');
      return;
    }

    if (password.length < 6) {
      setOwnerAccessStatus('Password must be at least 6 characters.');
      return;
    }

    if (password !== ownerAccessPasswordConfirm.trim()) {
      setOwnerAccessStatus('Passwords do not match.');
      return;
    }

    setOwnerAccessStatus('Saving owner password...');

    try {
      await saveUserAccess({
        email: ownerEmail,
        password,
        name: signedInUser?.name || activeCompany.ownerName,
        companyId: activeCompany.id,
        role: 'admin',
        mode: 'reset',
      });
      setOwnerAccessPassword('');
      setOwnerAccessPasswordConfirm('');
      setOwnerAccessStatus('Owner password updated. Use the new password at the next sign in.');
    } catch (error) {
      setOwnerAccessStatus(error instanceof Error ? error.message : 'Failed to update owner password.');
    }
  }

  function handleTechnicianSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    if (!technicianForm.name.trim() || !technicianForm.email.trim()) return;

    updateProfile({
      technicians: [createCompanyTechnician(technicianForm), ...profile.technicians],
    });
    setTechnicianForm(emptyTechnicianForm);
  }

  async function sendTechnicianAccess(technicianId: string, mode: AccessActionMode, password: string) {
    if (!activeCompany || !profile) return;
    const technician = profile.technicians.find((item) => item.id === technicianId);
    if (!technician) return;

    if (!technician.email.trim()) {
      setTechnicianAccessStatusById((statuses) => ({ ...statuses, [technicianId]: 'Technician email is required.' }));
      return;
    }

    if (password.trim().length < 6) {
      setTechnicianAccessStatusById((statuses) => ({ ...statuses, [technicianId]: 'Password must be at least 6 characters.' }));
      return;
    }

    setTechnicianAccessStatusById((statuses) => ({ ...statuses, [technicianId]: 'Saving access...' }));

    try {
      const result = await saveUserAccess({
        email: technician.email,
        password,
        name: technician.name,
        companyId: activeCompany.id,
        role: technician.role,
        mode,
      });
      const message =
        result.action === 'access_created'
          ? 'Access created. Share this email and password with the technician.'
          : result.action === 'access_updated'
            ? 'Access already existed. Password was updated.'
            : 'Password was reset.';
      setTechnicianAccessStatusById((statuses) => ({ ...statuses, [technicianId]: message }));

      if (mode === 'create' && technician.status !== 'disabled') {
        updateProfile({
          technicians: profile.technicians.map((item) =>
            item.id === technicianId ? { ...item, status: 'active' } : item,
          ),
        });
      }
    } catch (error) {
      setTechnicianAccessStatusById((statuses) => ({
        ...statuses,
        [technicianId]: error instanceof Error ? error.message : 'Access email failed.',
      }));
    }
  }

  function handleJobTypeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const name = jobTypeForm.name.trim();
    if (!name) return;
    const jobNumberPrefix =
      jobTypeForm.jobNumberPrefix.trim() ||
      name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) ||
      'JOB';

    updateProfile({
      jobTypes: [createCompanyJobType({ ...jobTypeForm, name, jobNumberPrefix }), ...profile.jobTypes],
    });
    setJobTypeForm(emptyJobTypeForm);
  }

  function addProfessionTemplate(template: NewCompanyJobTypeForm) {
    if (!profile) return;
    const configuredProfessionNames = new Set(profile.jobTypes.map((jobType) => jobType.name.toLowerCase()));
    if (configuredProfessionNames.has(String(template.name ?? '').toLowerCase())) return;

    updateProfile({
      jobTypes: [...profile.jobTypes, createCompanyJobType(template)],
    });
  }

  function removeJobType(jobTypeId: string) {
    if (!activeCompany || !profile) return;
    const removedJobType = profile.jobTypes.find((jobType) => jobType.id === jobTypeId);
    const jobTypes = profile.jobTypes.filter((jobType) => jobType.id !== jobTypeId);
    updateProfile({ jobTypes });
    deleteJobTypeFromBackend(jobTypeId, activeCompany.id, removedJobType?.name).catch((error) => {
      console.error('Failed to delete job type from backend', error);
    });

    if (selectedJobTypeId === jobTypeId) {
      setSelectedJobTypeId('');
    }
  }

  return {
    technicianForm,
    setTechnicianForm,
    technicianAccessStatusById,
    technicianAccessPasswordById,
    setTechnicianAccessPasswordById,
    ownerAccessPassword,
    ownerAccessPasswordConfirm,
    ownerAccessStatus,
    setOwnerAccessPassword,
    setOwnerAccessPasswordConfirm,
    jobTypeForm,
    setJobTypeForm,
    handleLogoUpload,
    generateOwnerPassword,
    saveOwnerPassword,
    handleTechnicianSubmit,
    sendTechnicianAccess,
    handleJobTypeSubmit,
    addProfessionTemplate,
    removeJobType,
  };
}
