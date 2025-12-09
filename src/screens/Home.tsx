import React from 'react';
import { View, Text, FlatList, Button, RefreshControl, StyleSheet } from 'react-native';
import { useTournaments } from '@app/hooks/useTournaments';
import { colors } from '@app/styles/colors';

export const HomeScreen: React.FC = () => {
  const { listQuery } = useTournaments();
  const tournaments = listQuery.data ?? [];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Torneos</Text>
      <FlatList
        data={tournaments}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={listQuery.isRefetching} onRefresh={listQuery.refetch} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{item.status}</Text>
            <Button title="Ver" onPress={() => {}} />
          </View>
        )}
        ListEmptyComponent={<Text>No hay torneos disponibles</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 8, gap: 4, marginBottom: 12, padding: 12 },
  container: { backgroundColor: colors.background, flex: 1, padding: 16 },
  meta: { color: colors.muted },
  name: { fontSize: 18, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 16 },
});

