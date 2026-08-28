import { IsNotEmpty, IsString } from 'class-validator'

/** Meta assigns this during WhatsApp Business Platform onboarding — an admin pastes it in from the Meta dashboard. See `vg-stage3-setup.md`. */
export class SetWhatsappPhoneNumberIdDto {
  @IsString()
  @IsNotEmpty()
  whatsappBusinessPhoneNumberId: string
}
