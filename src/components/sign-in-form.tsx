import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/text";
import { BrandGlyph } from "@/components/brand";
import { Banner, Button, Field, Section, SHADOW } from "@/components/ui";
import { useConnections, type Connection } from "@/core/connections";
import type { CredentialField, Credentials, ProviderDefinition, SignInChallenge } from "@/core/provider";
import { askForNotifications } from "@/lib/notify";

const defaults = (fields: CredentialField[]): Credentials => Object.fromEntries(fields.map((f) => [f.key, f.default ?? ""]));

export function SignInForm({ provider, existing, onDone }: { provider: ProviderDefinition; existing?: Connection; onDone: () => void }) {
  const addConnection = useConnections((s) => s.addConnection);
  const reauthenticate = useConnections((s) => s.reauthenticate);
  const qc = useQueryClient();
  const [challenge, setChallenge] = useState<SignInChallenge | null>(null);
  const [error, setError] = useState<string>();

  const form = useForm({
    defaultValues: {
      label: existing?.label ?? provider.name,
      credentials: defaults(provider.credentialFields),
      answers: {} as Credentials,
    },
    onSubmit: async ({ value }) => {
      setError(undefined);
      try {
        const res = await provider.signIn(challenge ? { ...value.credentials, ...value.answers } : value.credentials, challenge?.state);
        if (res.type === "challenge") {
          form.setFieldValue("answers", defaults(res.fields));
          setChallenge({ message: res.message, fields: res.fields, state: res.state });
          return;
        }
        if (existing) {
          await reauthenticate(existing.id, value.credentials, res.session);
          await qc.invalidateQueries();
        } else {
          await addConnection({
            providerId: provider.id,
            label: value.label.trim() || provider.name,
            accountLabel: res.accountLabel,
            credentials: value.credentials,
            session: res.session,
          });
        }
        askForNotifications();
        onDone();
      } catch (e) {
        setError((e as Error).message);
      }
    },
  });

  const fields = challenge ? challenge.fields : provider.credentialFields;
  const group = challenge ? "answers" : "credentials";

  const inputFor = (f: CredentialField) => (
    <form.Field key={`${group}.${f.key}`} name={`${group}.${f.key}`}>
      {(field) =>
        f.type === "select" ? (
          <View className="flex-row flex-wrap gap-2">
            {f.options?.map((o) => (
              <Pressable
                key={o.value}
                onPress={() => field.handleChange(o.value)}
                className={`px-4 py-2.5 rounded-2xl active:opacity-70 ${field.state.value === o.value ? "bg-foreground/15" : "bg-inset"}`}
              >
                <Text className={field.state.value === o.value ? "text-foreground font-semibold" : "text-muted"}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Field
            accessibilityLabel={f.label}
            help={f.help}
            placeholder={f.placeholder ?? f.label + (f.isOptional ? " (optional)" : "")}
            value={field.state.value ?? ""}
            onChangeText={field.handleChange}
            onBlur={field.handleBlur}
            secureTextEntry={f.type === "password"}
            keyboardType={f.type === "phone" || f.type === "otp" ? "number-pad" : f.type === "email" ? "email-address" : "default"}
            textContentType={f.type === "otp" ? "oneTimeCode" : f.type === "password" ? "password" : f.type === "phone" ? "telephoneNumber" : undefined}
            autoComplete={f.type === "otp" ? "sms-otp" : f.type === "password" ? "current-password" : f.type === "phone" ? "tel" : undefined}
            autoFocus={!!challenge && f === fields[0]}
          />
        )
      }
    </form.Field>
  );

  return (
    <View className="gap-4">
      <View className="items-center gap-3 pb-2">
        <View className="size-16 rounded-2xl bg-inset items-center justify-center" style={SHADOW}>
          <BrandGlyph provider={provider} size={34} />
        </View>
        <View className="items-center gap-1">
          <Text className="text-foreground text-xl font-semibold">{challenge ? "Verify it’s you" : provider.name}</Text>
          <Text className="text-muted text-sm text-center px-6">
            {challenge ? challenge.message : `Use the account you sign in to the ${provider.name} app with.`}
          </Text>
        </View>
      </View>

      {error ? <Banner>{error}</Banner> : null}

      {!challenge && !existing ? (
        <Section title="Name" className="mt-3">
          <form.Field name="label">
            {(field) => (
              <Field accessibilityLabel="Connection name" placeholder={provider.name} value={field.state.value} onChangeText={field.handleChange} />
            )}
          </form.Field>
        </Section>
      ) : null}

      <Section title={challenge ? "Code" : "Account"} className="mt-3">
        <View className="gap-3">{fields.map(inputFor)}</View>
      </Section>

      <form.Subscribe
        selector={(s) => ({
          busy: s.isSubmitting,
          missing: fields.some((f) => !f.isOptional && !s.values[group][f.key]),
        })}
      >
        {({ busy, missing }) => (
          <Button
            title={challenge ? "Verify" : existing ? "Re-authenticate" : "Sign In"}
            onPress={() => form.handleSubmit()}
            isLoading={busy}
            isDisabled={missing}
            className="mt-3"
          />
        )}
      </form.Subscribe>
    </View>
  );
}
