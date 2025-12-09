import React from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from '@app/services/auth';
import { colors } from '@app/styles/colors';

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});

type FormData = z.infer<typeof schema>;

export const LoginScreen: React.FC = () => {
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    await signIn(data.email, data.password);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ingresar</Text>
      <Controller
        name="email"
        control={control}
        render={({ field: { onChange, value } }) => (
          <TextInput
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={value}
            onChangeText={onChange}
            style={styles.input}
          />
        )}
      />
      {errors.email && <Text style={styles.error}>{errors.email.message}</Text>}
      <Controller
        name="password"
        control={control}
        render={({ field: { onChange, value } }) => (
          <TextInput
            placeholder="Contraseña"
            secureTextEntry
            value={value}
            onChangeText={onChange}
            style={styles.input}
          />
        )}
      />
      {errors.password && <Text style={styles.error}>{errors.password.message}</Text>}
      <Button title={isSubmitting ? 'Enviando...' : 'Entrar'} onPress={handleSubmit(onSubmit)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, padding: 16 },
  error: { color: colors.error, marginBottom: 8 },
  input: { borderColor: colors.border, borderRadius: 8, borderWidth: 1, marginBottom: 8, padding: 12 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 16 },
});

