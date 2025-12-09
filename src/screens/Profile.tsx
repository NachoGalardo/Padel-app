import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { getProfile, signOut } from '@app/services/auth';
import { useQuery } from '@tanstack/react-query';
import { colors } from '@app/styles/colors';

export const ProfileScreen: React.FC = () => {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Perfil</Text>
      {profile.data ? (
        <>
          <Text style={styles.row}>Nombre: {profile.data.display_name}</Text>
          <Text style={styles.row}>Email: {profile.data.email}</Text>
          <Text style={styles.row}>Nivel: {profile.data.level}</Text>
          <Text style={styles.row}>Rol: {profile.data.role}</Text>
        </>
      ) : (
        <Text>Cargando...</Text>
      )}
      <Button title="Salir" onPress={() => signOut()} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, gap: 8, padding: 16 },
  row: { fontSize: 16 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
});

