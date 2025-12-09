import React from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Gender, Level, signUp } from '@app/services/auth';
import { colors } from '@app/styles/colors';

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  displayName: z.string().min(2, 'Nombre requerido'),
  phone: z.string().min(6, 'Teléfono requerido'),
  gender: z.enum(['masculino', 'femenino']),
  level: z.enum(['1', '2', '3', '4', '5', '6', '7', '7B']),
});

type FormData = z.infer<typeof schema>;

export const RegisterScreen: React.FC = () => {
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    await signUp({
      email: data.email,
      password: data.password,
      displayName: data.displayName,
      phone: data.phone,
      gender: data.gender as Gender,
      level: data.level as Level,
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crear cuenta</Text>
      {(['email', 'password', 'displayName', 'phone', 'gender', 'level'] as const).map((field) => (
        <Controller
          key={field}
          name={field}
          control={control}
          render={({ field: { onChange, value } }) => (
            <TextInput
              placeholder={field}
              secureTextEntry={field === 'password'}
              autoCapitalize="none"
              value={value}
              onChangeText={onChange}
              style={styles.input}
            />
          )}
        />
      ))}
      {Object.values(errors).map((err) => (
        <Text key={err?.message} style={styles.error}>
          {err?.message}
        </Text>
      ))}
      <Button title={isSubmitting ? 'Enviando...' : 'Registrar'} onPress={handleSubmit(onSubmit)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, padding: 16 },
  error: { color: colors.error, marginBottom: 8 },
  input: { borderColor: colors.border, borderRadius: 8, borderWidth: 1, marginBottom: 8, padding: 12 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 16 },
});

