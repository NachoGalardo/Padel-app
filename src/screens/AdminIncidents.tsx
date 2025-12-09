import React from 'react';
import { View, Text, FlatList, Button, StyleSheet } from 'react-native';
import { useIncidentActions, useIncidents } from '@app/hooks/useIncidents';
import { colors } from '@app/styles/colors';

interface Props {
  tournamentId: string;
}

export const AdminIncidentsScreen: React.FC<Props> = ({ tournamentId }) => {
  const incidents = useIncidents(tournamentId);
  const { resolve } = useIncidentActions(tournamentId);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Incidencias</Text>
      <FlatList
        data={incidents.data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.description}</Text>
            <Text style={styles.meta}>{item.status}</Text>
            <Button
              title="Resolver"
              onPress={() =>
                resolve.mutate({ incidentId: item.id, resolution: 'Resuelto', newStatus: 'resolved' })
              }
            />
          </View>
        )}
        ListEmptyComponent={<Text>No hay incidencias</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 8, gap: 4, marginBottom: 12, padding: 12 },
  container: { backgroundColor: colors.background, flex: 1, padding: 16 },
  meta: { color: colors.muted },
  name: { fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 12 },
});

